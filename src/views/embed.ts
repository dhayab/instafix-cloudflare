import { escapeAttr } from '../utils/escape';

export interface ViewsData {
  Card: string;
  Title: string;
  ImageURL: string;
  VideoURL: string;
  URL: string;
  Description: string;
  OEmbedURL: string;
  Width: number;
  Height: number;
}

export function renderEmbed(v: ViewsData): string {
  const parts: string[] = [
    '<!DOCTYPE html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8"/>',
    '<meta name="theme-color" content="#CE0071"/>',
  ];

  if (v.Card)
    parts.push(`<meta name="twitter:card" content="${escapeAttr(v.Card)}"/>`);
  if (v.Title)
    parts.push(`<meta name="twitter:title" content="${escapeAttr(v.Title)}"/>`);
  if (v.ImageURL)
    parts.push(
      `<meta name="twitter:image" content="${escapeAttr(v.ImageURL)}"/>`,
    );

  if (v.VideoURL) {
    parts.push(
      `<meta name="twitter:player:width" content="${v.Width}"/>`,
      `<meta name="twitter:player:height" content="${v.Height}"/>`,
      `<meta name="twitter:player:stream" content="${escapeAttr(v.VideoURL)}"/>`,
      `<meta name="twitter:player:stream:content_type" content="video/mp4"/>`,
    );
  }

  if (v.VideoURL || v.ImageURL) {
    parts.push('<meta property="og:site_name" content="InstaFix"/>');
  }

  parts.push(`<meta property="og:url" content="${escapeAttr(v.URL)}"/>`);
  parts.push(
    `<meta property="og:description" content="${escapeAttr(v.Description)}"/>`,
  );

  if (v.ImageURL)
    parts.push(
      `<meta property="og:image" content="${escapeAttr(v.ImageURL)}"/>`,
    );

  if (v.VideoURL) {
    parts.push(
      `<meta property="og:video" content="${escapeAttr(v.VideoURL)}"/>`,
      `<meta property="og:video:secure_url" content="${escapeAttr(v.VideoURL)}"/>`,
      '<meta property="og:video:type" content="video/mp4"/>',
      `<meta property="og:video:width" content="${v.Width}"/>`,
      `<meta property="og:video:height" content="${v.Height}"/>`,
    );
  }

  if (v.OEmbedURL) {
    parts.push(
      `<link rel="alternate" href="${escapeAttr(v.OEmbedURL)}" type="application/json+oembed" title="${escapeAttr(v.Title)}"/>`,
    );
  }

  parts.push(
    `<meta http-equiv="refresh" content="0; url = ${escapeAttr(v.URL)}"/>`,
  );
  parts.push(
    '</head><body>Redirecting you to the post in a moment. ',
    `<a href="${escapeAttr(v.URL)}">Or click here.</a>`,
    '</body></html>',
  );

  return parts.join('');
}
