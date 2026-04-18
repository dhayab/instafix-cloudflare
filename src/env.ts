export interface Env {
  POSTS_CACHE?: KVNamespace;
  GRIDS?: R2Bucket;
  IMAGES?: ImagesBinding;
  CF_ACCOUNT_ID?: string;
  CF_BROWSER_API_TOKEN?: string;
  BR_DAILY_CAP?: string;
}
