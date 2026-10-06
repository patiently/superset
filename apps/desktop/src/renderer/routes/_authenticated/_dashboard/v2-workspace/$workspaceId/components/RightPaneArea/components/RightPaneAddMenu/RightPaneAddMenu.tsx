import { Trans } from "@lingui/react/macro";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@superset/ui/dropdown-menu";
import { BsTerminalPlus } from "react-icons/bs";
import {
	LuFileDiff,
	LuFolderTree,
	LuGitPullRequestArrow,
} from "react-icons/lu";
import { TbMessageCirclePlus, TbWorld } from "react-icons/tb";
import type { RightPaneKind } from "../../types";

interface RightPaneAddMenuProps {
	onAdd: (kind: RightPaneKind) => void;
	isChatEnabled: boolean;
}

export function RightPaneAddMenu({
	onAdd,
	isChatEnabled,
}: RightPaneAddMenuProps) {
	return (
		<>
			<DropdownMenuItem className="gap-2" onClick={() => onAdd("files")}>
				<LuFolderTree className="size-4" />
				<span>
					<Trans>Files</Trans>
				</span>
			</DropdownMenuItem>
			<DropdownMenuItem className="gap-2" onClick={() => onAdd("changes-list")}>
				<LuFileDiff className="size-4" />
				<span>
					<Trans>Changes</Trans>
				</span>
			</DropdownMenuItem>
			<DropdownMenuItem className="gap-2" onClick={() => onAdd("review")}>
				<LuGitPullRequestArrow className="size-4" />
				<span>
					<Trans>Review</Trans>
				</span>
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem className="gap-2" onClick={() => onAdd("browser")}>
				<TbWorld className="size-4" />
				<span>
					<Trans>Browser</Trans>
				</span>
			</DropdownMenuItem>
			{isChatEnabled && (
				<DropdownMenuItem className="gap-2" onClick={() => onAdd("chat-v3")}>
					<TbMessageCirclePlus className="size-4" />
					<span>
						<Trans>Chat v3</Trans>
					</span>
				</DropdownMenuItem>
			)}
			<DropdownMenuItem className="gap-2" onClick={() => onAdd("terminal")}>
				<BsTerminalPlus className="size-4" />
				<span>
					<Trans>Terminal</Trans>
				</span>
			</DropdownMenuItem>
		</>
	);
}
