const INSTAGRAM_HOSTS: ReadonlySet<string> = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
]);

// First path segments of Instagram pages that are not profiles.
const RESERVED_PATHS: ReadonlySet<string> = new Set([
  "about",
  "accounts",
  "developer",
  "direct",
  "explore",
  "legal",
  "locations",
  "p",
  "privacy",
  "reel",
  "reels",
  "s",
  "share",
  "stories",
  "tags",
  "tv",
  "web",
]);

// Letters, digits, periods and underscores; Instagram ignores letter case.
const USERNAME = /^[a-z0-9._]{1,30}$/;

const normalizeUsername = (value: string): string | null => {
  const username = value.toLowerCase();
  return USERNAME.test(username) && !RESERVED_PATHS.has(username)
    ? username
    : null;
};

/**
 * Username of a profile link such as "https://www.instagram.com/name/?igsh=…"
 * or "instagram.com/name"; null for anything else, including posts and reels.
 */
export const usernameFromProfileUrl = (candidate: string): string | null => {
  const withScheme = /^https?:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;
  if (!URL.canParse(withScheme)) {
    return null;
  }

  const url = new URL(withScheme);
  if (!INSTAGRAM_HOSTS.has(url.hostname)) {
    return null;
  }

  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const [first] = segments;
  return segments.length === 1 && first !== undefined
    ? normalizeUsername(first)
    : null;
};

/** Username written as a mention, such as "@name". */
export const usernameFromMention = (text: string): string | null => {
  const name = /^@([\w.]+)$/.exec(text)?.[1];
  return name === undefined ? null : normalizeUsername(name);
};

/**
 * The only profile a text points to through its links, if exactly one: shared
 * profiles often come as a link surrounded by other words.
 */
export const usernameFromLinks = (text: string): string | null => {
  const usernames = new Set(
    text
      .split(/\s+/)
      // Drop punctuation that ends a sentence right after a link.
      .map((token) =>
        usernameFromProfileUrl(token.replace(/[.,;:!?)\]]+$/, "")),
      )
      .filter((username) => username !== null),
  );
  const [username] = usernames;
  return usernames.size === 1 && username !== undefined ? username : null;
};
