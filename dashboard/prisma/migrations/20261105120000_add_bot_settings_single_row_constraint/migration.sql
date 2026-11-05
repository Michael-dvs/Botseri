-- Add single-row CHECK constraint to bot_settings
ALTER TABLE "bot_settings" ADD CONSTRAINT "bot_settings_single_row" CHECK (id = 1);
