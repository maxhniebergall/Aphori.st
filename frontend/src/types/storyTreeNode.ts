import { Quote } from "./quote";
import { QuoteCounts } from "./types";

export interface StoryTreeLeafNode {
    id: string;
    rootNodeId: string;
    parentId: string[];
    levelNumber: number;
}

export interface StoryTreeBranchNode{
    id: string;
    rootNodeId: string;
    parentId: string[];
    levelNumber: number;
    textContent: string;
    repliedToQuote: Quote;
    quoteCounts: QuoteCounts;
    authorId: string;
    createdAt: string;
}

export interface StoryTreeNode { // this value only exists in the frontend. it combines the post and the levels of the story tree
    isLeafNode: boolean;
    leafNode: StoryTreeLeafNode | null;
    branchNode: StoryTreeBranchNode | null;
}
