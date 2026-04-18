const BOTS = [
  'bot',
  'facebook',
  'embed',
  'got',
  'firefox/92',
  'firefox/38',
  'curl',
  'wget',
  'go-http',
  'yahoo',
  'generator',
  'whatsapp',
  'preview',
  'link',
  'proxy',
  'vkshare',
  'images',
  'analyzer',
  'index',
  'crawl',
  'spider',
  'python',
  'cfnetwork',
  'node',
  'mastodon',
  'http.rb',
  'discord',
  'ruby',
  'bun/',
  'fiddler',
  'revoltchat',
] as const;

export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const lc = userAgent.toLowerCase();
  return BOTS.some((b) => lc.includes(b));
}
