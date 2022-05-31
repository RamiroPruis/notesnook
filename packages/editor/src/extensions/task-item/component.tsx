import { Box, Flex, Image, ImageProps, Text } from "rebass";
import { NodeViewWrapper, NodeViewProps, NodeViewContent } from "../react";
import { ThemeProvider } from "emotion-theming";
import { Theme } from "@notesnook/theme";
import { Icon } from "../../toolbar/components/icon";
import { Icons } from "../../toolbar/icons";
import { Node } from "prosemirror-model";
import { Transaction, Selection } from "prosemirror-state";
import {
  findParentNodeClosestToPos,
  findChildren,
  NodeWithPos,
} from "@tiptap/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TaskItemNode } from "./task-item";

export function TaskItemComponent(props: ImageProps & NodeViewProps) {
  const { checked } = props.node.attrs;
  const [stats, setStats] = useState({ checked: 0, total: 0 });
  const { editor, updateAttributes, node, getPos } = props;
  const theme = editor.storage.theme as Theme;

  const toggle = useCallback(() => {
    if (!editor.isEditable) return false;
    updateAttributes({ checked: !checked });

    const tr = editor.state.tr;
    const parentPos = getPos();

    toggleChildren(node, tr, !checked, parentPos);

    editor.view.dispatch(tr);
    return true;
  }, [editor, getPos, node]);

  const nestedTaskList = useMemo(() => {
    return getChildren(node, getPos()).find(
      ({ node }) => node.type.name === "taskList"
    );
  }, [node.childCount]);

  const isNested = !!nestedTaskList;
  const isCollapsed: boolean = nestedTaskList
    ? editor.state.doc.nodeAt(nestedTaskList.pos)?.attrs.collapsed
    : false;

  useEffect(() => {
    if (!nestedTaskList) return;
    const { pos, node } = nestedTaskList;
    const children = findChildren(
      node,
      (node) => node.type.name === TaskItemNode.name
    );
    const checked = children.filter(({ node }) => node.attrs.checked).length;
    const total = children.length;
    setStats({ checked, total });
  }, []);

  return (
    <NodeViewWrapper>
      <ThemeProvider theme={theme}>
        <Flex
          sx={{
            //  mb: isNested ? 0 : 2,
            alignItems: "center",
            ":hover > .dragHandle, :hover > .toggleSublist": {
              opacity: 1,
            },
          }}
        >
          <Icon
            className="dragHandle"
            draggable="true"
            contentEditable={false}
            data-drag-handle
            path={Icons.dragHandle}
            sx={{
              opacity: 0,
              alignSelf: "start",
              mr: 2,
              cursor: "grab",
              ".icon:hover path": {
                fill: "var(--checked) !important",
              },
            }}
            size={20}
          />
          <Icon
            path={checked ? Icons.check : ""}
            stroke="1px"
            sx={{
              border: "2px solid",
              borderColor: checked ? "checked" : "icon",
              borderRadius: "default",
              alignSelf: "start",
              mr: 2,
              p: "1px",
              cursor: "pointer",
              ":hover": {
                borderColor: "checked",
              },
              ":hover .icon path": {
                fill: "var(--checked) !important",
              },
            }}
            onMouseDown={(e) => {
              if (toggle()) e.preventDefault();
            }}
            color={checked ? "checked" : "icon"}
            size={13}
          />

          <NodeViewContent
            style={{
              textDecorationLine: checked ? "line-through" : "none",
              color: checked ? "var(--checked)" : "var(--text)",
              flex: 1,
              // marginBottom: isNested ? 0 : 5,
            }}
          />

          {isNested && (
            <>
              {isCollapsed && (
                <Text variant={"body"} sx={{ color: "fontTertiary", mr: 35 }}>
                  {stats.checked}/{stats.total}
                </Text>
              )}
              <Icon
                className="toggleSublist"
                path={isCollapsed ? Icons.chevronDown : Icons.chevronUp}
                sx={{
                  opacity: isCollapsed ? 1 : 0,
                  position: "absolute",
                  right: 0,
                  alignSelf: "start",
                  mr: 2,
                  cursor: "pointer",
                  ".icon:hover path": {
                    fill: "var(--checked) !important",
                  },
                }}
                size={20}
                onClick={() => {
                  editor
                    .chain()
                    .setNodeSelection(getPos())
                    .command(({ tr }) => {
                      const { pos, node } = nestedTaskList;
                      tr.setNodeMarkup(pos, undefined, {
                        collapsed: !isCollapsed,
                      });
                      return true;
                    })
                    .run();
                }}
              />
            </>
          )}
        </Flex>
      </ThemeProvider>
    </NodeViewWrapper>
  );
}

function toggleChildren(
  node: Node,
  tr: Transaction,
  toggleState: boolean,
  parentPos: number
): Transaction {
  const children = findChildren(
    node,
    (node) => node.type.name === TaskItemNode.name
  );
  for (const { pos } of children) {
    // need to add 1 to get inside the node
    const actualPos = pos + parentPos + 1;
    tr.setNodeMarkup(actualPos, undefined, {
      checked: toggleState,
    });
  }
  return tr;
}

function getChildren(node: Node, parentPos: number) {
  const children: NodeWithPos[] = [];
  node.forEach((node, offset) => {
    children.push({ node, pos: parentPos + offset + 1 });
  });
  return children;
}
