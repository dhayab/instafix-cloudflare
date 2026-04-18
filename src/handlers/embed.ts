import type { Context } from 'hono';
import type { AppBindings } from '../index';
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
  if (path.includes('/reel/')) return 'reel';
  if (path.includes('/reels/')) return 'reels';
  return 'p';
}

function sendEmbed(c: Context<AppBindings>, v: ViewsData): Response {
  return c.html(renderEmbed(v));
}

export async function embedHandler(c: Context<AppBindings>): Promise<Response> {
  const reqId = c.get('reqId');
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
    c.set('metadata', {
      handler: 'embed',
      outcome: 'invalid_input',
      invalidReason: 'mediaNum',
    });
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
      c.set('metadata', {
        handler: 'embed',
        outcome: 'invalid_input',
        invalidReason: 'stories_decode',
      });
      return sendEmbed(c, view);
    }
  } else if (urlPath.startsWith('/share/')) {
    try {
      postID = await getSharePostID(postID);
    } catch {
      view.Description = 'Failed to get new postID from share URL';
      c.set('metadata', {
        handler: 'embed',
        outcome: 'invalid_input',
        invalidReason: 'share_unresolvable',
      });
      return sendEmbed(c, view);
    }
  }

  const kind = kindFromPath(urlPath);
  const requestURI = url.pathname + url.search;
  const canonical =
    'https://instagram.com' + requestURI.replace('/' + mediaNumParam, '');
  view.URL = canonical;

  if (!isBot(c.req.header('User-Agent'))) {
    c.set('metadata', {
      handler: 'embed',
      outcome: 'bot_redirect',
      postID,
      kind,
    });
    return c.redirect(canonical, 302);
  }

  let data;
  try {
    data = await getData(postID, kind, c.env, c.executionCtx, reqId);
  } catch {
    c.set('metadata', {
      handler: 'embed',
      outcome: 'scrape_failed',
      postID,
      kind,
    });
    return c.redirect(canonical, 302);
  }
  if (!data || data.Medias.length === 0) {
    c.set('metadata', {
      handler: 'embed',
      outcome: 'scrape_failed',
      postID,
      kind,
    });
    return c.redirect(canonical, 302);
  }
  if (mediaNum > data.Medias.length) {
    view.Description = 'Media number out of range';
    c.set('metadata', {
      handler: 'embed',
      outcome: 'out_of_range',
      postID,
      kind,
      mediaNum,
    });
    return sendEmbed(c, view);
  }
  if (!data.Username) {
    view.Description = 'Post not found';
    c.set('metadata', {
      handler: 'embed',
      outcome: 'not_found',
      postID,
      kind,
    });
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
    c.set('metadata', {
      handler: 'embed',
      outcome: 'out_of_range',
      postID,
      kind,
      mediaNum,
    });
    return sendEmbed(c, view);
  }

  const typename = item.TypeName;
  const isImage = typename.includes('Image') || typename.includes('StoryVideo');

  let targetPath = '';
  let card = '';
  let hasVideo = false;
  let fallback: string | undefined;

  if (mediaNum === 0 && isImage && data.Medias.length > 1) {
    card = 'summary_large_image';
    view.Card = card;
    targetPath = `/grid/${postID}`;
    view.ImageURL = targetPath;
  } else if (isImage) {
    card = 'summary_large_image';
    view.Card = card;
    targetPath = `/images/${postID}/${Math.max(1, mediaNum)}`;
    view.ImageURL = targetPath;
  } else {
    const tooLarge = (item.ContentLength ?? 0) > TELEGRAM_VIDEO_SIZE_LIMIT;
    if (tooLarge && data.Thumbnail) {
      // Downgrade to a thumbnail card with play-icon overlay.
      card = 'summary_large_image';
      view.Card = card;
      targetPath = `/thumbnails/${postID}`;
      view.ImageURL = targetPath;
      fallback = 'thumbnail_card';
    } else {
      card = 'player';
      view.Card = card;
      targetPath = `/videos/${postID}/${Math.max(1, mediaNum)}`;
      view.VideoURL = targetPath;
      hasVideo = true;
      if (data.Thumbnail) view.ImageURL = `/thumbnails/${postID}`;
      const host = url.host;
      const scheme = url.protocol.replace(':', '');
      view.OEmbedURL = `${scheme}://${host}/oembed?text=${encodeURIComponent(view.Description)}&url=${encodeURIComponent(view.URL)}`;
    }
  }

  if (isDirect) {
    c.set('metadata', {
      handler: 'embed',
      outcome: 'direct_redirect',
      postID,
      kind,
      mediaNum,
      card,
      hasVideo,
      fallback,
    });
    return c.redirect(targetPath, 302);
  }

  c.set('metadata', {
    handler: 'embed',
    outcome: 'ok',
    postID,
    kind,
    mediaNum,
    card,
    hasVideo,
    fallback,
  });
  return sendEmbed(c, view);
}
