-- Captured from a stopped crocodilestick/calibre-web-automated:v4.0.6 container
-- after startup migrations completed on 2026-08-14. Only migration-relevant
-- tables are retained from the captured sqlite_master output.

CREATE TABLE user (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(64),
  email VARCHAR(120),
  role SMALLINT,
  password VARCHAR,
  kindle_mail VARCHAR(120),
  kindle_mail_subject VARCHAR(256),
  locale VARCHAR(2),
  sidebar_view INTEGER,
  default_language VARCHAR(3),
  denied_tags VARCHAR,
  allowed_tags VARCHAR,
  denied_column_value VARCHAR,
  allowed_column_value VARCHAR,
  view_settings JSON,
  kobo_only_shelves_sync INTEGER,
  hardcover_token VARCHAR,
  theme INTEGER,
  auto_send_enabled BOOLEAN,
  allow_additional_ereader_emails BOOLEAN,
  UNIQUE (name),
  UNIQUE (email),
  UNIQUE (hardcover_token)
);

CREATE TABLE settings (
  id INTEGER NOT NULL PRIMARY KEY,
  mail_server VARCHAR,
  mail_password VARCHAR,
  config_hardcover_token VARCHAR,
  config_calibre_dir VARCHAR,
  config_calibre_split BOOLEAN,
  config_calibre_split_dir VARCHAR
);

CREATE TABLE book_read_link (
  id INTEGER NOT NULL PRIMARY KEY,
  book_id INTEGER,
  user_id INTEGER,
  read_status INTEGER NOT NULL,
  last_modified DATETIME,
  last_time_started_reading DATETIME,
  times_started_reading INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES user (id)
);

CREATE TABLE bookmark (
  id INTEGER NOT NULL PRIMARY KEY,
  user_id INTEGER,
  book_id INTEGER,
  format VARCHAR COLLATE NOCASE,
  bookmark_key VARCHAR,
  FOREIGN KEY(user_id) REFERENCES user (id)
);

CREATE TABLE kobo_reading_state (
  id INTEGER NOT NULL PRIMARY KEY,
  user_id INTEGER,
  book_id INTEGER,
  last_modified DATETIME,
  priority_timestamp DATETIME,
  FOREIGN KEY(user_id) REFERENCES user (id)
);

CREATE TABLE kobo_bookmark (
  id INTEGER NOT NULL PRIMARY KEY,
  kobo_reading_state_id INTEGER,
  last_modified DATETIME,
  location_source VARCHAR,
  location_type VARCHAR,
  location_value VARCHAR,
  progress_percent FLOAT,
  content_source_progress_percent FLOAT,
  FOREIGN KEY(kobo_reading_state_id) REFERENCES kobo_reading_state (id)
);

CREATE TABLE shelf (
  id INTEGER NOT NULL PRIMARY KEY,
  uuid VARCHAR,
  name VARCHAR,
  is_public INTEGER,
  user_id INTEGER,
  kobo_sync BOOLEAN,
  created DATETIME,
  last_modified DATETIME,
  FOREIGN KEY(user_id) REFERENCES user (id)
);

CREATE TABLE book_shelf_link (
  id INTEGER NOT NULL PRIMARY KEY,
  book_id INTEGER,
  "order" INTEGER,
  shelf INTEGER,
  date_added DATETIME,
  FOREIGN KEY(shelf) REFERENCES shelf (id)
);

CREATE TABLE kosync_progress (
  id INTEGER NOT NULL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  document VARCHAR NOT NULL,
  progress VARCHAR NOT NULL,
  percentage FLOAT NOT NULL,
  device VARCHAR NOT NULL,
  device_id VARCHAR,
  timestamp TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE magic_shelf (
  id INTEGER NOT NULL PRIMARY KEY,
  uuid VARCHAR,
  name VARCHAR,
  is_public INTEGER,
  is_system BOOLEAN,
  user_id INTEGER,
  icon VARCHAR,
  rules JSON,
  kobo_sync BOOLEAN,
  created DATETIME,
  last_modified DATETIME,
  CONSTRAINT unique_user_system_shelf_name UNIQUE (user_id, name, is_system),
  FOREIGN KEY(user_id) REFERENCES user (id)
);

CREATE TABLE kobo_annotation_sync (
  id INTEGER NOT NULL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  annotation_id VARCHAR NOT NULL,
  book_id INTEGER NOT NULL,
  synced_to_hardcover BOOLEAN,
  hardcover_journal_id INTEGER,
  created_at DATETIME,
  last_synced DATETIME,
  highlighted_text VARCHAR,
  highlight_color VARCHAR,
  note_text VARCHAR,
  FOREIGN KEY(user_id) REFERENCES user (id)
);
