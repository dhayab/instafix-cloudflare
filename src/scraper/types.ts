export interface Media {
  TypeName: string;
  URL: string;
  Width?: number;
  Height?: number;
  ContentLength?: number;
}

export interface InstaData {
  PostID: string;
  Username: string;
  Caption: string;
  Medias: Media[];
  Width?: number;
  Height?: number;
  Thumbnail?: string;
}
