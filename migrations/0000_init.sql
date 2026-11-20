CREATE TABLE `records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`text` text NOT NULL,
	`kind` text DEFAULT 'manual' NOT NULL,
	`task_id` text,
	`created` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `records_date_idx` ON `records` (`date`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`deadline` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created` text NOT NULL,
	`done` text
);
--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);