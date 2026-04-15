CREATE TABLE `telemetryEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sessionId` varchar(96) NOT NULL,
	`path` varchar(512) NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`activeMs` int NOT NULL DEFAULT 0,
	`interactionCount` int NOT NULL DEFAULT 0,
	`visible` int NOT NULL DEFAULT 1,
	`payload` text,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telemetryEvents_id` PRIMARY KEY(`id`)
);
