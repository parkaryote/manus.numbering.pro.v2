CREATE TABLE `ocrJobs` (
	`id` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`s3Key` varchar(512) NOT NULL,
	`gcsInputPath` varchar(512),
	`gcsOutputPath` varchar(512),
	`status` enum('RUNNING','DONE','ERROR') NOT NULL DEFAULT 'RUNNING',
	`errorMessage` text,
	`result` text,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ocrJobs_id` PRIMARY KEY(`id`)
);
