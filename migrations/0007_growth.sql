-- growth plugins, all dependent on the analytics base.

-- analytics: custom events + visitor identification (email -> salted hash).
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  day TEXT NOT NULL,
  ts INTEGER NOT NULL,
  name TEXT NOT NULL,
  path TEXT,
  ref TEXT,
  country TEXT,
  vid TEXT,
  ident TEXT
);

CREATE INDEX idx_events_site_day_ts ON events (site_id, day, ts);
CREATE INDEX idx_events_site_name ON events (site_id, name);
CREATE INDEX idx_events_site_ident ON events (site_id, ident);

-- revenue: payments from Stripe webhook / payment API, attributed to first touch.
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  ident TEXT,
  source_ref TEXT,
  source_path TEXT,
  external_id TEXT UNIQUE,
  customer TEXT
);

CREATE INDEX idx_payments_site_ts ON payments (site_id, ts);

-- signals: external events — GitHub commits, X and Reddit mentions.
CREATE TABLE signal_watchers (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  source TEXT NOT NULL,
  query TEXT NOT NULL,
  last_poll_at INTEGER,
  last_status TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  watcher_id TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  author TEXT,
  external_id TEXT UNIQUE,
  ts INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_signals_site_ts ON signals (site_id, ts DESC);

-- aicrawl: server-side AI crawler tracking.
CREATE TABLE crawls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  day TEXT NOT NULL,
  ts INTEGER NOT NULL,
  vendor TEXT NOT NULL,
  agent TEXT,
  path TEXT NOT NULL
);

CREATE INDEX idx_crawls_site_day ON crawls (site_id, day, ts);

-- goals: conversion targets over events and paths.
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- share: public dashboard links.
CREATE TABLE site_shares (
  site_id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
