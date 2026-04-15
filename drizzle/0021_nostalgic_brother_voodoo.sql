CREATE TABLE `subjectShares` (
	`id` int AUTO_INCREMENT NOT NULL,
	`subjectId` int NOT NULL,
	`ownerUserId` int NOT NULL,
	`shareToken` varchar(80) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`isActive` int NOT NULL DEFAULT 1,
	`viewCount` int NOT NULL DEFAULT 0,
	`lastAccessedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subjectShares_id` PRIMARY KEY(`id`),
	CONSTRAINT `subjectShares_shareToken_unique` UNIQUE(`shareToken`)
);
