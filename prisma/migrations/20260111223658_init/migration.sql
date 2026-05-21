-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "apolloFilters" JSONB,
    "customPrompt" TEXT
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "apolloId" TEXT,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "website" TEXT,
    "industry" TEXT,
    "location" TEXT,
    "employeeCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "batchId" TEXT,
    "websiteContent" TEXT,
    "websiteScrapedAt" DATETIME,
    "websiteScrapeFailed" BOOLEAN NOT NULL DEFAULT false,
    "websiteScrapeError" TEXT,
    "validEmployeeCount" INTEGER NOT NULL DEFAULT 0,
    "titleValidationAt" DATETIME,
    "pipelineState" TEXT NOT NULL DEFAULT 'pending_generation',
    "notGeneratedReason" JSONB,
    CONSTRAINT "Company_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "apolloId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "title" TEXT NOT NULL,
    "isTitleValid" BOOLEAN NOT NULL DEFAULT false,
    "companyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "promptUsed" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "geminiModelUsed" TEXT,
    "editedSubject" TEXT,
    "editedBody" TEXT,
    "reviewedAt" DATETIME,
    "reviewedBy" TEXT,
    "finalSubject" TEXT,
    "finalBody" TEXT,
    "approvedAt" DATETIME,
    "approvedBy" TEXT,
    "sentAt" DATETIME,
    "sentTo" TEXT,
    "sendError" TEXT,
    "sendAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Email_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "metadata" JSONB,
    "performedBy" TEXT,
    "performedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_apolloId_key" ON "Company"("apolloId");

-- CreateIndex
CREATE INDEX "Company_pipelineState_idx" ON "Company"("pipelineState");

-- CreateIndex
CREATE INDEX "Company_batchId_idx" ON "Company"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_apolloId_key" ON "Employee"("apolloId");

-- CreateIndex
CREATE INDEX "Employee_companyId_idx" ON "Employee"("companyId");

-- CreateIndex
CREATE INDEX "Employee_isTitleValid_idx" ON "Employee"("isTitleValid");

-- CreateIndex
CREATE UNIQUE INDEX "Email_companyId_key" ON "Email"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Prompt_name_key" ON "Prompt"("name");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_performedAt_idx" ON "AuditLog"("performedAt");
