export type Lane = 'planned' | 'actual';

export type Block = {
  id: string;
  startMin: number;
  endMin: number;
  title: string;
  tags: string[];
  lane: Lane;
};
