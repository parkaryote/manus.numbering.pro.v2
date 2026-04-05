CREATE TABLE `typingAttempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`questionId` int NOT NULL,
	`mode` enum('practice','exam') NOT NULL,
	`answerLength` int NOT NULL,
	`inputChars` int NOT NULL,
	`timeToFirstKey` int NOT NULL,
	`typingDuration` int NOT NULL,
	`backspaceCount` int NOT NULL,
	`pasteDetected` int NOT NULL DEFAULT 0,
	`effectiveSpeed` int NOT NULL,
	`lengthBucket` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `typingAttempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `typingBaselines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`mode` enum('practice','exam') NOT NULL,
	`lengthBucket` int NOT NULL,
	`baselineSpeed` int NOT NULL,
	`sampleCount` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `typingBaselines_id` PRIMARY KEY(`id`)
);
