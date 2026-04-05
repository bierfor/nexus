import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { ClickEvent, Link, Metric, SiteVisit, User } from './models.js';

const UA_HEADER = 'x-finsh-ua';

export function clientUa(req: IncomingMessage): string | undefined {
  const fwd = req.headers[UA_HEADER];
  if (typeof fwd === 'string') return fwd;
  if (Array.isArray(fwd)) return fwd[0];
  const ua = req.headers['user-agent'];
  if (typeof ua === 'string') return ua;
  if (Array.isArray(ua)) return ua[0];
  return undefined;
}

export function clientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  if (Array.isArray(xff) && xff[0]) {
    const first = String(xff[0]).split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const ra = req.socket?.remoteAddress;
  return ra ? String(ra).slice(0, 64) : '0';
}

/** Salted daily visitor key — one row per visitor per UTC day (monetization / uniques). Not reversible. */
export function visitorDayFingerprint(req: IncomingMessage, dayUtc: string): string {
  const ip = clientIp(req);
  const ua = (clientUa(req) ?? '').slice(0, 400);
  const raw = `finsh|v1|${ip}|${ua}|${dayUtc}`;
  return createHash('sha256').update(raw).digest('hex');
}

export function utcDayString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

const PATH_RE = /^\/[a-zA-Z0-9/_-]*$/;

export function normalizeSitePath(path: string): string | null {
  const p = path.trim().split('?')[0]?.split('#')[0] ?? '';
  if (p.length > 200 || p.length < 1) return null;
  if (!PATH_RE.test(p)) return null;
  return p || '/';
}

export type AdminAnalyticsResult = {
  periodDays: number;
  fromIso: string;
  toIso: string;
  summary: {
    rawClicks: number;
    uniqueClickers: number;
    botSkipsRecorded: number;
    siteViewsRaw: number;
    siteViewsUnique: number;
    adImpressions: number;
    shortlinkGateImpressions: number;
    adOutboundClicks: number;
  };
  daily: Array<{ date: string; rawClicks: number; uniqueClickers: number; siteViewsRaw: number; siteViewsUnique: number }>;
  topLinks: Array<{ slug: string; targetUrl: string; rawClicks: number; uniqueClickers: number }>;
  topPaths: Array<{ path: string; views: number; uniqueVisitors: number }>;
  users: { total: number; newInPeriod: number };
  linksTotal: number;
};

export async function computeAdminAnalytics(periodDays: number): Promise<AdminAnalyticsResult> {
  const days = Math.min(Math.max(periodDays, 1), 365);
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  start.setUTCHours(0, 0, 0, 0);

  const fromIso = start.toISOString();
  const toIso = end.toISOString();

  const [
    rawDaily,
    uniqueDaily,
    siteRawDaily,
    siteUniqueDaily,
    topLinksAgg,
    topPathsAgg,
    usersTotal,
    newUsers,
    linksTotal,
    adImpDoc,
    gateImpDoc,
    outClickDoc,
  ] = await Promise.all([
    ClickEvent.aggregate<{ _id: string; c: number }>([
      { $match: { at: { $gte: start, $lte: end } } },
      { $group: { _id: '$dayUtc', c: { $sum: 1 } } },
    ]),
    ClickEvent.aggregate<{ _id: string; c: number }>([
      { $match: { at: { $gte: start, $lte: end } } },
      { $group: { _id: { d: '$dayUtc', v: '$visitorKey' } } },
      { $group: { _id: '$_id.d', c: { $sum: 1 } } },
    ]),
    SiteVisit.aggregate<{ _id: string; c: number }>([
      { $match: { at: { $gte: start, $lte: end } } },
      { $group: { _id: '$dayUtc', c: { $sum: 1 } } },
    ]),
    SiteVisit.aggregate<{ _id: string; c: number }>([
      { $match: { at: { $gte: start, $lte: end } } },
      { $group: { _id: { d: '$dayUtc', v: '$visitorKey' } } },
      { $group: { _id: '$_id.d', c: { $sum: 1 } } },
    ]),
    ClickEvent.aggregate<{
      _id: string;
      rawClicks: number;
      visitors: string[];
    }>([
      { $match: { at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: '$slug',
          rawClicks: { $sum: 1 },
          visitors: { $addToSet: '$visitorKey' },
        },
      },
      { $sort: { rawClicks: -1 } },
      { $limit: 20 },
    ]),
    SiteVisit.aggregate<{
      _id: string;
      views: number;
      visitors: string[];
    }>([
      { $match: { at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: '$path',
          views: { $sum: 1 },
          visitors: { $addToSet: '$visitorKey' },
        },
      },
      { $sort: { views: -1 } },
      { $limit: 15 },
    ]),
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: start, $lte: end } }),
    Link.countDocuments(),
    Metric.findOne({ key: 'ad_impressions' }).lean(),
    Metric.findOne({ key: 'shortlink_gate_impressions' }).lean(),
    Metric.findOne({ key: 'ad_outbound_clicks' }).lean(),
  ]);

  const rawMap = new Map(rawDaily.map((x) => [x._id, x.c]));
  const uqMap = new Map(uniqueDaily.map((x) => [x._id, x.c]));
  const svRawMap = new Map(siteRawDaily.map((x) => [x._id, x.c]));
  const svUqMap = new Map(siteUniqueDaily.map((x) => [x._id, x.c]));

  const daily: AdminAnalyticsResult['daily'] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = utcDayString(d);
    daily.push({
      date: key,
      rawClicks: rawMap.get(key) ?? 0,
      uniqueClickers: uqMap.get(key) ?? 0,
      siteViewsRaw: svRawMap.get(key) ?? 0,
      siteViewsUnique: svUqMap.get(key) ?? 0,
    });
  }

  const slugs = topLinksAgg.map((x) => x._id);
  const linkDocs =
    slugs.length > 0
      ? ((await Link.find({ slug: { $in: slugs } }).select('slug targetUrl').lean()) as any[])
      : [];
  const targetBySlug = new Map(linkDocs.map((l: any) => [l.slug, l.targetUrl ?? '']));

  const topLinks = topLinksAgg.map((row) => ({
    slug: row._id,
    targetUrl: String(targetBySlug.get(row._id) ?? ''),
    rawClicks: row.rawClicks,
    uniqueClickers: row.visitors?.length ?? 0,
  }));

  const topPaths = topPathsAgg.map((row) => ({
    path: row._id,
    views: row.views,
    uniqueVisitors: row.visitors?.length ?? 0,
  }));

  const totalRawClicks = daily.reduce((s, x) => s + x.rawClicks, 0);
  const totalUniqueClickers = await ClickEvent.distinct('visitorKey', {
    at: { $gte: start, $lte: end },
  }).then((a) => a.length);

  const botDoc = (await Metric.findOne({ key: 'click_bot_skips' }).lean()) as any;
  const siteViewsRaw = await SiteVisit.countDocuments({ at: { $gte: start, $lte: end } });
  const siteViewsUnique = await SiteVisit.distinct('visitorKey', {
    at: { $gte: start, $lte: end },
  }).then((a) => a.length);

  return {
    periodDays: days,
    fromIso,
    toIso,
    summary: {
      rawClicks: totalRawClicks,
      uniqueClickers: totalUniqueClickers,
      botSkipsRecorded: botDoc?.count ?? 0,
      siteViewsRaw,
      siteViewsUnique,
      adImpressions: (adImpDoc as any)?.count ?? 0,
      shortlinkGateImpressions: (gateImpDoc as any)?.count ?? 0,
      adOutboundClicks: (outClickDoc as any)?.count ?? 0,
    },
    daily,
    topLinks,
    topPaths,
    users: { total: usersTotal, newInPeriod: newUsers },
    linksTotal,
  };
}
