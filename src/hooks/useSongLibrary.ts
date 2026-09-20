import { useEffect, useRef, useState } from "react";
import type { Song } from "../types";
import * as storage from "../lib/storage";
import { downloadFile } from "../lib/download";

interface UseSongLibraryArguments {
	song: Song;
	applySong: (song: Song) => void;
	showToast: (message: string) => void;
}

interface ImportConflicts {
	conflicts: Song[];
	freshCount: number;
}

// The saved-song library (IndexedDB): hydration on mount, debounced autosave,
// save/load/delete/reorder, and JSON export/import with an overwrite prompt
// for id conflicts.
export function useSongLibrary({ song, applySong, showToast }: UseSongLibraryArguments) {
	const [hydrated, setHydrated] = useState(false);
	const [librarySongs, setLibrarySongs] = useState<Song[]>([]);
	const [dirty, setDirty] = useState(false);
	const [importConflicts, setImportConflicts] = useState<ImportConflicts | null>(null);

	// Hydrate from IndexedDB: the saved library plus the last-opened song.
	// The ghost screen holds until both are in.
	useEffect(() => {
		const lastOpenedId = storage.getLastOpenedId();
		Promise.all([
			storage.listSongs().then(setLibrarySongs),
			lastOpenedId
				? storage.loadSong(lastOpenedId).then((loaded) => {
						if (loaded) applySong(loaded);
					})
				: null,
		])
			.catch(() => {})
			.finally(() => setHydrated(true));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Debounced autosave once the song is in the library. Loading or switching
	// songs isn't an edit — only changes after that count.
	const skipAutosaveRef = useRef(true);
	const autosaveSongIdRef = useRef(song.id);
	useEffect(() => {
		if (skipAutosaveRef.current || autosaveSongIdRef.current !== song.id) {
			skipAutosaveRef.current = false;
			autosaveSongIdRef.current = song.id;
			setDirty(false);
			return;
		}
		setDirty(true);
		const timer = setTimeout(async () => {
			try {
				// Never listSongs here — deserializing every song's stem audio on
				// each autosave froze the browser.
				if (await storage.hasSong(song.id)) {
					const stamped = { ...song, updatedAt: Date.now() };
					await storage.saveSong(stamped);
					setLibrarySongs((current) =>
						current.map((candidate) => (candidate.id === stamped.id ? stamped : candidate)),
					);
				}
				setDirty(false);
			} catch {
				showToast("Autosave failed");
			}
		}, 1000);
		return () => clearTimeout(timer);
	}, [song, showToast]);

	const saveCurrentSong = async () => {
		const stamped = { ...song, updatedAt: Date.now() };
		try {
			await storage.saveSong(stamped);
		} catch {
			showToast("Save failed");
			return;
		}
		// Patch in place — re-reading the library is heavy with stem audio.
		setLibrarySongs((current) =>
			current.some((candidate) => candidate.id === stamped.id)
				? current.map((candidate) => (candidate.id === stamped.id ? stamped : candidate))
				: [stamped, ...current],
		);
		setDirty(false);
		showToast("Saved");
	};

	const exportLibrary = async () =>
		downloadFile(await storage.exportLibrary(), "tab-editor-songs.tabz", "application/octet-stream");

	const exportSong = async (songId: string) => {
		const compressed = await storage.exportSong(songId);
		if (!compressed) return;
		const title = librarySongs.find((candidate) => candidate.id === songId)?.title.trim();
		downloadFile(compressed, `${title || "untitled-song"}.tabz`, "application/octet-stream");
	};

	const finishImport = async (songs: Song[]) => {
		await storage.importSongs(songs);
		setLibrarySongs(await storage.listSongs());
		// If the open song was overwritten, swap the editor to the imported
		// version — otherwise the next autosave would clobber the import.
		const replacement = songs.find((candidate) => candidate.id === song.id);
		if (replacement) applySong(storage.migrateSong(replacement));
	};

	const importFromFile = async (file: File) => {
		try {
			const songs = storage.parseSongsFile(new Uint8Array(await file.arrayBuffer()));
			const existingIds = new Set(librarySongs.map((candidate) => candidate.id));
			const conflicts = songs.filter((candidate) => existingIds.has(candidate.id));
			const fresh = songs.filter((candidate) => !existingIds.has(candidate.id));
			await finishImport(fresh);
			if (conflicts.length > 0) setImportConflicts({ conflicts, freshCount: fresh.length });
			else showToast(`Imported ${fresh.length}`);
		} catch {
			showToast("Import failed");
		}
	};

	const resolveImportConflicts = async (overwriteIds: string[]) => {
		if (!importConflicts) return;
		await finishImport(importConflicts.conflicts.filter((candidate) => overwriteIds.includes(candidate.id)));
		showToast(`Imported ${importConflicts.freshCount + overwriteIds.length}`);
		setImportConflicts(null);
	};

	const loadSong = async (songId: string) => {
		const loaded = await storage.loadSong(songId);
		if (!loaded) return;
		storage.setLastOpenedId(songId);
		applySong(loaded);
	};

	const deleteSong = async (songId: string) => {
		await storage.deleteSong(songId);
		setLibrarySongs(await storage.listSongs());
	};

	const moveSong = async (songId: string, direction: -1 | 1) => {
		await storage.moveSong(songId, direction);
		setLibrarySongs(await storage.listSongs());
	};

	return {
		hydrated,
		librarySongs,
		isAutosaved: !dirty,
		importConflicts,
		saveCurrentSong,
		exportLibrary,
		exportSong,
		importFromFile,
		resolveImportConflicts,
		loadSong,
		deleteSong,
		moveSong,
	};
}
