CREATE TABLE `ocrJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`s3Url` text NOT NULL,
	`gcsUri` text,
	`operationName` text,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`extractedText` text,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `ocrJobs_id` PRIMARY KEY(`id`)
);
