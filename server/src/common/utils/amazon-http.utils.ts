const AMAZON_BOT_CHALLENGE_PATTERNS = [
  /validateCaptcha/i,
  /captcha/i,
  /not a robot/i,
  /triggerInterstitialChallenge/i,
  /["']bm-verify["']/i,
  /\/_sec\/verify\?provider=interstitial/i,
];

const AMAZON_BROWSER_HEADERS: HeadersInit = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  dnt: '1',
  'upgrade-insecure-requests': '1',
  'sec-ch-ua': '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
};

export function amazonRequestHeaders(url: string | URL, cookie = ''): HeadersInit {
  const origin = new URL(url).origin;
  return {
    ...AMAZON_BROWSER_HEADERS,
    referer: `${origin}/`,
    ...(cookie ? { cookie } : {}),
  };
}

export function isAmazonBotChallenge(body: string): boolean {
  return AMAZON_BOT_CHALLENGE_PATTERNS.some((pattern) => pattern.test(body));
}
