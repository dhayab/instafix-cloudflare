import type { Context } from 'hono';
import type { Env } from '../env';
import { getData, type PostKind } from '../scraper';
import { mediaIdToCode } from '../utils/shortcode';
import { getSharePostID } from '../utils/share';
import { isBot } from '../utils/bot';
import { truncate } from '../utils/escape';
import { renderEmbed, type ViewsData } from '../views/embed';

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 400;

// Telegram silently drops inline-video previews above ~20 MB. For reels
// that exceed this, we fall back to a thumbnail card with a play-icon
// overlay so the user still sees something.
const TELEGRAM_VIDEO_SIZE_LIMIT = 20 * 1024 * 1024;

function kindFromPath(path: string): PostKind {
  if (path.startsWith('/reel/') || path.startsWith('/share/reel/'))
    return 'reel';
  if (path.startsWith('/reels/')) return 'reels';
  if (path.startsWith('/tv/')) return 'tv';
  if (path.startsWith('/stories/') || path.startsWith('/p/')) return 'p';
  // /{username}/reel/... or /{username}/p/... fall here
  if (path.includes('/reel/')) return 'reel';
  if (path.includes('/reels/')) return 'reels';
  return 'p';
}

function sendEmbed(c: Context, v: ViewsData): Response {
  return c.html(renderEmbed(v));
}

export async function embedHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const url = new URL(c.req.url);
  const urlPath = url.pathname;
  const mediaNumParam =
    c.req.param('mediaNum') ?? url.searchParams.get('img_index') ?? '0';
  const mediaNum = Number.parseInt(mediaNumParam, 10);

  const view: ViewsData = {
    Card: '',
    Title: 'InstaFix',
    ImageURL: '',
    VideoURL: '',
    URL: '',
    Description: '',
    OEmbedURL: '',
    Width: DEFAULT_WIDTH,
    Height: DEFAULT_HEIGHT,
  };

  if (!Number.isFinite(mediaNum)) {
    view.Description = 'Invalid img_index parameter';
    return sendEmbed(c, view);
  }

  const isDirect =
    url.searchParams.get('direct') === 'true' ||
    c.req.header('X-Embed-Type') === 'direct';
  const isGallery =
    url.searchParams.get('gallery') === 'true' ||
    c.req.header('X-Embed-Type') === 'gallery';

  let postID = c.req.param('postID') ?? '';
  if (urlPath.startsWith('/stories/')) {
    try {
      postID = mediaIdToCode(BigInt(postID));
    } catch {
      view.Description = 'Invalid postID';
      return sendEmbed(c, view);
    }
  } else if (urlPath.startsWith('/share/')) {
    try {
      postID = await getSharePostID(postID);
    } catch {
      view.Description = 'Failed to get new postID from share URL';
      return sendEmbed(c, view);
    }
  }

  const kind = kindFromPath(urlPath);
  const requestURI = url.pathname + url.search;
  const canonical =
    'https://instagram.com' + requestURI.replace('/' + mediaNumParam, '');
  view.URL = canonical;

  if (!isBot(c.req.header('User-Agent'))) {
    return c.redirect(canonical, 302);
  }

  let data;
  try {
    data = await getData(postID, kind, c.env, c.executionCtx);
  } catch {
    return c.redirect(canonical, 302);
  }
  if (!data || data.Medias.length === 0) {
    return c.redirect(canonical, 302);
  }
  if (mediaNum > data.Medias.length) {
    view.Description = 'Media number out of range';
    return sendEmbed(c, view);
  }
  if (!data.Username) {
    view.Description = 'Post not found';
    return sendEmbed(c, view);
  }

  view.Title = '@' + data.Username;
  if (!isGallery) {
    view.Description = truncate(data.Caption, 253);
  }
  if (data.Width) view.Width = data.Width;
  if (data.Height) view.Height = data.Height;

  const idx = Math.max(1, mediaNum) - 1;
  const item = data.Medias[idx];
  if (!item) {
    view.Description = 'Media number out of range';
    return sendEmbed(c, view);
  }

  const typename = item.TypeName;
  const isImage = typename.includes('Image') || typename.includes('StoryVideo');

  let targetPath = '';
  if (mediaNum === 0 && isImage && data.Medias.length > 1) {
    view.Card = 'summary_large_image';
    targetPath = `/grid/${postID}`;
    view.ImageURL = targetPath;
  } else if (isImage) {
    view.Card = 'summary_large_image';
    targetPath = `/images/${postID}/${Math.max(1, mediaNum)}`;
    view.ImageURL = targetPath;
  } else {
    const tooLarge = (item.ContentLength ?? 0) > TELEGRAM_VIDEO_SIZE_LIMIT;
    if (tooLarge && data.Thumbnail) {
      // Downgrade to a thumbnail card with play-icon overlay.
      view.Card = 'summary_large_image';
      targetPath = `/thumbnails/${postID}`;
      view.ImageURL = targetPath;
    } else {
      view.Card = 'player';
      targetPath = `/videos/${postID}/${Math.max(1, mediaNum)}`;
      view.VideoURL = targetPath;
      if (data.Thumbnail) view.ImageURL = `/thumbnails/${postID}`;
      const host = url.host;
      const scheme = url.protocol.replace(':', '');
      view.OEmbedURL = `${scheme}://${host}/oembed?text=${encodeURIComponent(view.Description)}&url=${encodeURIComponent(view.URL)}`;
    }
  }

  if (isDirect) return c.redirect(targetPath, 302);

  return sendEmbed(c, view);
}
