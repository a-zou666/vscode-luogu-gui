import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({ default: {} }));
vi.mock('./api', () => ({ getCaptcha: vi.fn(), parseProblemID: () => '' }));

const { cookieString, praseCookie, getUserSvg, getArticleCategory } =
  await import('./workspaceUtils');
const { languageFamily, fileExtToLanguage, defaultLanguageVersion } =
  await import('./shared');

describe('语言自动识别（对齐洛谷官网行为）', () => {
  it('maps common extensions to a language family', () => {
    expect(fileExtToLanguage.cpp).toBe('C++');
    expect(fileExtToLanguage.c).toBe('C');
    expect(fileExtToLanguage.pas).toBe('Pascal');
    expect(fileExtToLanguage.rs).toBe('Rust');
  });

  it('every default language version exists in its family', () => {
    // 默认版本名写错会让 askForLanguage 静默回退到弹窗（“没自动识别”的典型症状）
    for (const [family, version] of Object.entries(defaultLanguageVersion)) {
      const versions = languageFamily[family as keyof typeof languageFamily];
      expect(versions, `${family} 不在 languageFamily 中`).toBeDefined();
      expect(
        Object.keys(versions as object),
        `${family} 缺少默认版本 ${version}`
      ).toContain(version);
    }
  });

  it('defaults C++/C/Pascal submissions to an O2 build', () => {
    for (const family of ['C++', 'C', 'Pascal'] as const) {
      const version = defaultLanguageVersion[family];
      const entry = (
        languageFamily[family] as Record<string, { id: number; O2?: true }>
      )[version];
      expect(entry, `${family} 默认版本 ${version} 不存在`).toBeDefined();
      expect(entry.O2, `${family} 默认版本应带 O2`).toBe(true);
    }
  });
});

describe('cookieString', () => {
  it('formats cookie from uid and clientID', () => {
    expect(cookieString({ uid: 12345, clientID: 'abc' })).toBe(
      '_uid=12345;__client_id=abc'
    );
  });

  it('handles numeric clientID', () => {
    expect(cookieString({ uid: 1, clientID: '0' })).toBe(
      '_uid=1;__client_id=0'
    );
  });
});

describe('praseCookie', () => {
  it('returns empty object for undefined', () => {
    expect(praseCookie(undefined)).toEqual({});
  });

  it('returns empty object for empty array', () => {
    expect(praseCookie([])).toEqual({});
  });

  it('parses uid from cookie', () => {
    const result = praseCookie(['_uid=12345; path=/']);
    expect(result.uid).toBe(12345);
  });

  it('parses clientID from cookie', () => {
    const result = praseCookie(['__client_id=abcdef; path=/']);
    expect(result.clientID).toBe('abcdef');
  });

  it('parses both uid and clientID', () => {
    const result = praseCookie(['_uid=42; path=/', '__client_id=xyz; path=/']);
    expect(result.uid).toBe(42);
    expect(result.clientID).toBe('xyz');
  });
});

describe('getUserSvg', () => {
  it('returns empty string for ccfLevel 0', () => {
    expect(getUserSvg(0)).toBe('');
  });

  it('returns green svg for levels 3-5', () => {
    const svg = getUserSvg(3);
    expect(svg).toContain('#52c41a');
    expect(svg).toContain('<svg');
  });

  it('returns blue svg for levels 6-7', () => {
    const svg = getUserSvg(6);
    expect(svg).toContain('#3498db');
  });

  it('returns gold svg for levels 8+', () => {
    const svg = getUserSvg(8);
    expect(svg).toContain('#ffc116');
  });
});

describe('getArticleCategory', () => {
  it('returns correct category names', () => {
    expect(getArticleCategory(1)).toBe('个人记录');
    expect(getArticleCategory(2)).toBe('题解');
    expect(getArticleCategory(3)).toBe('科技·工程');
  });
});
