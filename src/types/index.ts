export interface FileItem {
  id: string;
  file: File;
  name: string;
  size: number;
}

export interface PageItem {
  id: string;
  pageIndex: number;
  sourceFileId: string;
  rotation: number;
  thumbnail?: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export type ImageFormat = 'png' | 'jpeg';
export type ImageScale = 1 | 2 | 3;
export type SortOption = 'name-asc' | 'name-desc' | 'rank-high' | 'rank-low';
export type MarkupTool =
  | 'highlight-free'
  | 'highlight-line'
  | 'rectangle'
  | 'text'
  | 'mosaic'
  | 'none';

export interface MarkupStyle {
  color: string;
  lineWidth: number;
  opacity: number;
  fontSize?: number;
  mosaicSize?: number;
  mosaicIntensity?: number;
}

export interface DrawingAction {
  tool: MarkupTool;
  style: MarkupStyle;
  points?: { x: number; y: number }[];
  rect?: { x: number; y: number; width: number; height: number };
  text?: { x: number; y: number; content: string };
  mosaicArea?: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageData?: string;
  };
  page: number;
}
