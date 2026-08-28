// Icon set backed by lucide-react (stroke icons, no fill), themed once here:
// 1em sizing so icons scale with surrounding text, and a stroke weight close
// to the plate's hairline language. Components keep their original names so
// call sites never care about the library.
import {
	ArrowLeft,
	ChevronDown,
	ChevronUp,
	CircleHelp,
	ClipboardPaste,
	Download,
	Maximize2,
	Minimize2,
	Play,
	Settings,
	SkipBack,
	Square,
	Trash2,
	Upload,
	X,
	type LucideIcon,
} from "lucide-react";

interface IconProps {
	className?: string;
}

function themed(Icon: LucideIcon) {
	// oxlint-disable-next-line only-export-components -- every export IS a component; the HOC just hides that from the checker
	return function ThemedIcon({ className = "" }: IconProps) {
		return <Icon size="1em" strokeWidth={1.75} className={`inline-block align-[-0.14em] ${className}`} />;
	};
}

export const BackIcon = themed(ArrowLeft);
export const MoveUpIcon = themed(ChevronUp);
export const MoveDownIcon = themed(ChevronDown);
export const TrashIcon = themed(Trash2);
export const PlayIcon = themed(Play);
export const StopIcon = themed(Square);
export const SkipStartIcon = themed(SkipBack);
export const GearIcon = themed(Settings);
export const HelpIcon = themed(CircleHelp);
export const InsertIcon = themed(ClipboardPaste);
export const ExpandIcon = themed(Maximize2);
export const ShrinkIcon = themed(Minimize2);
export const CloseIcon = themed(X);
export const DownloadIcon = themed(Download);
export const UploadIcon = themed(Upload);
