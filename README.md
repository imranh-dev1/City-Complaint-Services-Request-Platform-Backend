# City Complaint & Service Request Platform — Backend

**API Reference, Architecture Overview & Code Audit Report**

| | |
|---|---|
| **Project** | `city-complaint-platform-backend` |
| **Stack** | Node.js · TypeScript 7 · Express 5 · Prisma 7 (PostgreSQL) · Redis · Zod 4 |
| **Integrations** | Cloudinary (uploads), Nodemailer/Gmail (OTP email), bKash Tokenized Checkout, Stripe Checkout, Google Identity Services |
| **Base URL (dev)** | `http://localhost:5000` |
| **API prefix** | `/api/v1` |
| **OpenAPI-style Postman collection** | [`city-complaint-platform.postman_collection.json`](https://github.com/imranh-dev1/City-Complaint-Services-Request-Platform-Backend/blob/main/city-complaint-platform.postman_collection.json) |
| **Report date** | 2026-09-30 |
| **Type check** | `npx tsc --noEmit` → clean |
| **Lint** | `npx @biomejs/biome lint ./src` → 49 warnings, 0 errors |

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Authentication & Authorization Model](#2-authentication--authorization-model)
3. [API Reference](#3-api-reference)
4. [Postman Collection Guide](#4-postman-collection-guide)
5. [Code Audit Report](#5-code-audit-report)
   - [Severity summary](#severity-summary)
   - [Critical findings](#critical)
   - [High findings](#high)
   - [Medium findings](#medium)
   - [Low findings](#low)
   - [Security & hardening gaps](#security--hardening-gaps)
   - [Dead code & duplication](#dead-code--duplication)
6. [Remediation Roadmap](#6-remediation-roadmap)
7. [Local Development Reference](#7-local-development-reference)
8. [Verification Appendix](#8-verification-appendix)

---

## 1. Architecture

### 1.1 Request pipeline

```
Request
  └─ cors({ origin: FRONTEND_URL, credentials: true })          app.ts:23
  └─ express.urlencoded({ extended: true })                       app.ts:30
  └─ express.json()                    ← no `verify` hook        app.ts:32  ⚠ BUG-02
  └─ cookieParser()                                              app.ts:33
  └─ router mount (auth / users / departments / categories /
     complaints / complaints/:id/feedback / notifications /
     payments)                                                  app.ts:42-49
       └─ auth(...roles)      middleware/checkAuth.ts            JWT + DB re-check
       └─ upload.*            lib/multer.ts                      memory storage, 5 MB × 5
       └─ validateRequest()   middleware/validateRequest.ts     Zod → replaces req.body
       └─ controller          catchAsync wrapper                 utils/catchAsync.ts
            └─ service         Prisma / Redis / gateway SDKs
  └─ notFound                        middleware/notFound.ts
  └─ globalErrorHandler              middleware/globalErrorHandler.ts
```

### 1.2 Module map

| Module | Route base | Responsibility |
|---|---|---|
| `auth` | `/api/v1/auth` | Registration + OTP verification, credentials login, Google login, JWT rotation, password recovery, staff provisioning |
| `user` | `/api/v1/users` | Profile image, profile update, password change |
| `department` | `/api/v1/departments` | Department CRUD, manager assignment, technician roster |
| `category` | `/api/v1/categories` | Category CRUD (each category owns an SLA budget in hours) |
| `complaint` | `/api/v1/complaints` | Complaint lifecycle: submit → review → assign → progress → resolve, notes, attachments, SLA computation |
| `feedback` | `/api/v1/complaints/:id/feedback` | Citizen rating after resolution (closes the complaint) |
| `notification` | `/api/v1/notifications` | In-app notification inbox |
| `payment` | `/api/v1/payments` | bKash + Stripe initiation, execution, status sync, webhooks, refunds |
| `admin` | `/api/v1/admin` | User administration, dashboard analytics, audit trail — **not mounted** ⚠ BUG-06 |

### 1.3 Data model (Prisma, PostgreSQL)

```
User ──1:1── Citizen            (nid @unique, address, wardNo, area)
     ──1:1── Technician         (specialization, rating, availability, hourlyRate)
     │
     ├─ Department ──1:1── manager (managerId @unique)
     │        └─< Category      (slaHours → drives Complaint.slaDeadline)
     │
     ├─< Complaint ──> Category
     │      ├── assignedTechnician → User
     │      ├──< ComplaintAttachment   (Cloudinary url + publicId)
     │      ├──< ComplaintAssignment   (PENDING → ACCEPTED → COMPLETED / REJECTED)
     │      ├──< ComplaintUpdate       (status timeline + free-text notes)
     │      ├──< Payment               (bkash / stripe, merchantInvoiceNumber @unique)
     │      └───1:1 Feedback           (complaintId @unique, rating 1-5)
     │
     ├──< Notification
     └───< AuditLog
```

Key constraints that drive application logic:

- `User.email` is `@unique`; `User.name`, `User.role` are **not** unique.
- `Department.name`, `Department.code`, `Category.name` are `@unique` — and rows are **soft-deleted** via `deletedAt`, never removed.
- `ComplaintStatus` state machine: `SUBMITTED → UNDER_REVIEW → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED`, plus terminal `REJECTED` / `CANCELLED`.
- `Complaint.slaDeadline = now + Category.slaHours`; SLA status is derived at read time (`utils/sla.ts`), never persisted.

### 1.4 Cross-cutting concerns

| Concern | Implementation | Note |
|---|---|---|
| Validation | Zod 4 via `validateRequest` (body only) | Params and query strings are **not** schema-validated |
| Errors | `AppError(statusCode, message)` → `globalErrorHandler` | Production masks all messages ⚠ BUG-04 |
| Responses | `sendResponse({ success, statusCode, message, data, meta })` | Lists add `{ page, limit, total, totalPages }` |
| Pagination | `utils/pagination.ts` | `page ≥ 1`, `1 ≤ limit ≤ 100`, default `createdAt desc` |
| Audit trail | `utils/auditLog.ts` | Fire-and-forget; failures are logged and swallowed |
| Notifications | `utils/notify.ts` | Fire-and-forget DB insert |
| Caching / OTP / idempotency | Redis (`redisClient`) | OTP TTLs: registration 10 min, password reset 5 min, Stripe event dedupe 7 days |

---

## 2. Authentication & Authorization Model

### 2.1 Token strategy

Hybrid **cookie + bearer**. `auth()` (`middleware/checkAuth.ts:25`) resolves the access token in this order:

1. `req.cookies.accessToken`
2. `Authorization: Bearer <token>`
3. `Authorization: <token>` (raw header)

`utils/authCookie.ts` issues both cookies as `httpOnly`, with `secure` + `sameSite: "none"` in production (cross-origin frontend) and `lax` otherwise. Access token max-age 1 day, refresh token 7 days.

### 2.2 Token contents

```jsonc
{ "userId": "<uuid>", "name": "...", "email": "...", "role": "CITIZEN" }
```

On every authenticated request `checkAuth` re-reads the user from the database and requires the row to match **all four** claims (`checkAuth.ts:59-66`), then rejects `isDeleted` and `status === BLOCKED`.

> **Consequence:** because `name` and `role` are part of the match, a profile rename or an admin role change invalidates every issued token until the affected user logs in again. See [BUG-09](#high).

### 2.3 Role matrix

| Capability | CITIZEN | TECHNICIAN | ADMIN | SUPER_ADMIN |
|---|:--:|:--:|:--:|:--:|
| Register / login / Google login / forgot / reset | ✅ | ✅ | ✅ | ✅ |
| Upload profile image, update profile, change password | ✅ | ✅ | ✅ | ✅ |
| Submit complaint | ✅ | ❌ | ✅ | ✅ |
| View complaints | own only | assigned + all department-scoped ⚠ | all | all |
| Update / delete own complaint | `SUBMITTED`/`UNDER_REVIEW` only | ❌ | ✅ | ✅ |
| Change status | ❌ | `ASSIGNED→IN_PROGRESS`, `IN_PROGRESS→RESOLVED` | full transition map | full transition map |
| Assign technician | ❌ | ❌ | ✅ | ✅ |
| Accept assignment | ❌ | ✅ (own) | ❌ | ❌ |
| Add note / attachments | own | assigned | all | all |
| Submit feedback | own, `RESOLVED`/`CLOSED` only | ❌ (403 in service) | ❌ (403 in service) | ❌ (403 in service) |
| Notifications | ✅ | ✅ | ✅ | ✅ |
| Initiate / execute / query payment | ✅ | ❌ | ✅ | ✅ |
| Refund payment | ❌ | ❌ | ✅ | ✅ |
| Department & category CRUD | ❌ | ❌ | ✅ | ✅ |
| `/payments/gateways`, all webhooks | public | public | public | public |

---

## 3. API Reference

**67 documented requests · 61 unique endpoints.** Bodies are JSON unless stated otherwise.

### 3.1 Health

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/` | public | Liveness probe |
| `GET` | `/api/v1/does-not-exist` | public | Demonstrates `notFound` → 404 JSON |

### 3.2 Auth — `/api/v1/auth`

| Method | Path | Auth | Request | Success |
|---|---|---|---|---|
| `POST` | `/register` | public | `name`(≥2), `email`, `password`(≥6), `phone?`, `citizen{nid?,address?,wardNo?,area?}` | `201` — 6-digit OTP emailed (Redis, 10 min). **No DB row yet.** |
| `POST` | `/register-email-verify` | public | `email`, `otp` (6 digits) | `201` — creates CITIZEN + Citizen, sets cookies, returns both tokens |
| `POST` | `/login` | public | `email`, `password`(≥6) | `200` — sets cookies + returns both tokens |
| `POST` | `/google` | public | `idToken` | `200` — tokens only, **no cookies set** ⚠ BUG-15 |
| `GET` | `/me` | any role | — | `200` — user + `citizen`, password omitted |
| `POST` | `/refresh-token` | public | reads `refreshToken` **cookie** | `200` — rotates both tokens |
| `POST` | `/forgot-password` | public | `email` | `200` — 6-digit OTP emailed (Redis, 5 min) |
| `POST` | `/reset-password` | public | `email`, `otp`, `newPassword` | `200` — 8+ chars with upper/lower/digit/special |
| `POST` | `/register-staff` | ADMIN, SUPER_ADMIN | `name`, `email`, `password`(strong), `role: TECHNICIAN\|ADMIN`, `phone?`, `departmentId?`, `specialization?`, `experience?` | `201` — auto-creates Technician profile |
| `POST` | `/logout` | any role | — | `200` — clears cookies only; tokens remain valid ⚠ |

**Seeded accounts** (`utils/seed.ts`, run on every boot):

| Role | Email | Password |
|---|---|---|
| SUPER_ADMIN | `superadmin@gmail.com` | `Super@admin12345` |
| ADMIN | `admin@gmail.com` | `admin@12345` |
| CITIZEN | `citizen@gmail.com` | `citizen@12345` |
| TECHNICIAN | `technician@gmail.com` | `technician@12345` |

### 3.3 Users — `/api/v1/users`

| Method | Path | Auth | Request |
|---|---|---|---|
| `PATCH` | `/profile-image-upload` | any role | `multipart/form-data`, single file in field **`profile-image`**, ≤5 MB, jpeg/png/webp/gif/avif |
| `PATCH` | `/profile-update` | any role | `name?`, `phone?` (BD format), `citizen{nid?,address?,wardNo?,area?}` — Citizen row is upserted |
| `PATCH` | `/change-password` | any role | `oldPassword`, `newPassword`, `confirmPassword` (must match, must differ, ≥6 chars) |

### 3.4 Departments — `/api/v1/departments`

| Method | Path | Auth | Request / Query |
|---|---|---|---|
| `POST` | `/` | ADMIN, SUPER_ADMIN | `name`(3-100), `code`(`[A-Z0-9_-]+`, 2-20, upper-cased), `description?`(≤500) |
| `GET` | `/` | any role | `page`, `limit`, `sortBy=name\|createdAt`, `sortOrder`, `search`, `isActive`, `withManager` |
| `GET` | `/:id` | any role | includes non-deleted categories + counts |
| `GET` | `/:id/technicians` | ADMIN, SUPER_ADMIN, TECHNICIAN | technician roster with Technician profile |
| `POST` | `/:id/manager` | ADMIN, SUPER_ADMIN | `userId` (uuid, role ∈ ADMIN/SUPER_ADMIN/TECHNICIAN) |
| `PATCH` | `/:id` | ADMIN, SUPER_ADMIN | partial `name` / `code` / `description` / `isActive` |
| `DELETE` | `/:id` | ADMIN, SUPER_ADMIN | soft delete; blocked when categories exist |

### 3.5 Categories — `/api/v1/categories`

| Method | Path | Auth | Request / Query |
|---|---|---|---|
| `POST` | `/` | ADMIN, SUPER_ADMIN | `name`(3-100, globally unique), `description?`(≤500), `slaHours?`(int 1-720, default 48), `departmentId`(uuid) |
| `GET` | `/` | any role | no pagination; **returns only `isActive: true`** ⚠ BUG-16 |
| `GET` | `/:id` | any role | 404 when missing or soft-deleted |
| `PATCH` | `/:id` | ADMIN, SUPER_ADMIN | partial `name` / `description` / `isActive` / `slaHours` / `departmentId` |
| `DELETE` | `/:id` | ADMIN, SUPER_ADMIN | soft delete + `isActive = false` |

### 3.6 Complaints — `/api/v1/complaints`

| Method | Path | Auth | Request / Query |
|---|---|---|---|
| `POST` | `/` | CITIZEN, ADMIN, SUPER_ADMIN | `multipart/form-data`: field **`complaintPayload`** (single JSON string) + up to 5 × `images`. Or plain JSON: `title`(5-200), `description`(10-2000), `address`(5-500), `latitude?`, `longitude?`, `priority?`, `categoryId`(uuid) |
| `GET` | `/my-complaints` | CITIZEN | all list filters, forced to own complaints |
| `GET` | `/my-assigned` | TECHNICIAN | `status?`, `page`, `limit` — always `createdAt desc` |
| `GET` | `/search` | any role | **`?q=`** (title/description/address/category name), plus list filters |
| `GET` | `/` | any role | `page`, `limit`, `sortBy=createdAt\|updatedAt\|priority\|status`, `sortOrder`, `search`, `status`, `priority`, `categoryId`, `departmentId`, `sla` |
| `GET` | `/:id` | any role | attachments, assignments, updates, payments, feedback, `_count`, computed `sla` |
| `GET` | `/:id/updates` | any role | status timeline + notes, newest first |
| `PATCH` | `/:id` | any role | `title?`, `description?`, `address?`, `latitude?`, `longitude?`, `priority?`. CITIZEN only while `SUBMITTED`/`UNDER_REVIEW` |
| `DELETE` | `/:id` | any role ⚠ | soft delete. CITIZEN restricted to cancellable statuses and no `PENDING`/`PAID` payment |
| `PATCH` | `/:id/status` | ADMIN, SUPER_ADMIN, assigned TECHNICIAN | `status`, `note?`(≤1000). Transitions enforced server-side |
| `POST` | `/:id/assign` | ADMIN, SUPER_ADMIN | `technicianId`(uuid) — sets `ASSIGNED`, marks technician `BUSY`, notifies both parties |
| `POST` | `/:id/accept` | assigned TECHNICIAN | flips assignment → `ACCEPTED`, status → `IN_PROGRESS` |
| `POST` | `/:id/cancel` | any role | `SUBMITTED`/`UNDER_REVIEW`/`ASSIGNED`/`IN_PROGRESS` only |
| `POST` | `/:id/notes` | any role | `message`(3-2000), `status?` |
| `POST` | `/:id/attachments` | any role | `multipart/form-data`, up to 5 × `images` |

**Status transition map** (`complaint.service.ts:43-66`):

```
ADMIN / SUPER_ADMIN                      TECHNICIAN
SUBMITTED     → UNDER_REVIEW, REJECTED    ASSIGNED   → IN_PROGRESS
UNDER_REVIEW  → REJECTED                  IN_PROGRESS → RESOLVED
ASSIGNED      → (none)                    others     → (none)
IN_PROGRESS   → (none)
RESOLVED      → CLOSED
CLOSED / REJECTED / CANCELLED → (none)
```

Resolving a complaint (inside one transaction) sets `resolvedAt`, completes the assignment, frees the technician, writes a timeline entry and notifies the citizen.

### 3.7 Feedback — `/api/v1/complaints/:id/feedback`

| Method | Path | Auth | Request |
|---|---|---|---|
| `POST` | `/` | CITIZEN (service rejects non-citizens) | `rating` (int 1-5), `comment?`(≤1000). Only while `RESOLVED`/`CLOSED`; one per complaint. Closes the complaint |
| `GET` | `/` | owner citizen / assigned technician / admin | Feedback + author |

> ⚠ **Both endpoints are currently broken** — see [BUG-01](#critical).

### 3.8 Notifications — `/api/v1/notifications`

| Method | Path | Auth | Query |
|---|---|---|---|
| `GET` | `/` | any role | `page`, `limit`, `isRead` |
| `PATCH` | `/read-all` | any role | returns `{ updatedCount }` |
| `PATCH` | `/:id/read` | owner | 404 for another user's id |

### 3.9 Payments — `/api/v1/payments`

| Method | Path | Auth | Request / Query |
|---|---|---|---|
| `GET` | `/gateways` | **public** | `[{ gateway, label, configured }]` |
| `POST` | `/initiate` | CITIZEN, ADMIN, SUPER_ADMIN | `complaintId`(uuid), `amount?`, `gateway?`(`bkash`\|`stripe`), `callbackURL?`, `successURL?`, `cancelURL?` |
| `POST` | `/:id/execute` | owner, ADMIN, SUPER_ADMIN | bKash only; Stripe returns 400 (webhook-only) |
| `GET` | `/:id/status` | owner, ADMIN, SUPER_ADMIN | Polls the gateway and reconciles local state (Stripe recovery path) |
| `GET` | `/:id` | owner, ADMIN, SUPER_ADMIN | Payment + complaint + payer |
| `GET` | `/my-payments` | any role | `status?`, `gateway?`, `page`, `limit` |
| `GET` | `/admin/all` | ADMIN, SUPER_ADMIN | `status?`, `gateway?`, `complaintId?`, `page`, `limit` |
| `POST` | `/:id/refund` | ADMIN, SUPER_ADMIN | `reason`(3-300, required), `amount?` — ⚠ amount ignored, see [BUG-08](#high) |
| `POST` | `/webhook/bkash` | **public** | `{ paymentID }` — no signature verification ⚠ BUG-14 |
| `POST` | `/webhook` | **public** | Duplicate alias of `/webhook/bkash` |
| `POST` | `/webhook/stripe` | **public** | `Stripe-Signature` header + raw body — ⚠ always 400, see [BUG-02](#critical) |

**Payment status derivation**

| Gateway | Input | Result |
|---|---|---|
| bKash | `transactionStatus` | `COMPLETED → PAID`, `CANCELLED`/`REFUNDED` → `CANCELLED`, else `FAILED` |
| Stripe | `status` = `expired` | `CANCELLED` |
| Stripe | `payment_status` = `paid`/`no_payment_required` | `PAID` |
| Stripe | otherwise | `PENDING` |

Downgrade protection (`isDowngrade`, `payment.service.ts:43-53`) prevents a terminal state (`PAID`/`REFUNDED`/`CANCELLED`) from being overwritten, except `PAID → REFUNDED`. Transitions are idempotent: an unchanged state skips notifications and audit writes.

### 3.10 Admin — `/api/v1/admin` *(defined but not mounted)*

| Method | Path | Auth | Request / Query |
|---|---|---|---|
| `GET` | `/users` | ADMIN, SUPER_ADMIN | `search`, `role`, `status`, `page`, `limit` |
| `PATCH` | `/users/:id/status` | ADMIN, SUPER_ADMIN | `status: ACTIVE\|BLOCKED\|DELETED` |
| `PATCH` | `/users/:id/role` | SUPER_ADMIN | `role` — auto-provisions Citizen/Technician profile |
| `PATCH` | `/users/:id/department` | ADMIN, SUPER_ADMIN | `departmentId` (staff roles only) |
| `GET` | `/dashboard-stats` | ADMIN, SUPER_ADMIN | 15 parallel aggregations: users by role, complaints by status, 5 recent, SLA breached/approaching, revenue, resources, avg rating, top-5 categories |
| `GET` | `/audit-logs` | ADMIN, SUPER_ADMIN | `entityType`, `action`, `userId`, `page`, `limit` |

> ⚠ Every route above currently returns **404** — see [BUG-06](#critical).

---

## 4. Postman Collection Guide

Import `city-complaint-platform.postman_collection.json` (schema `v2.1.0`).

### 4.1 Setup

1. Set collection variable `baseUrl` → `http://localhost:5000`.
2. Run **01 - Auth / Login (tester citizen)**. Its test script writes `accessToken` and `refreshToken` into the collection variables.
3. Every other request inherits collection-level `Bearer {{accessToken}}`; public requests override it with `noauth`.
4. Switch persona by running a different **Login** request — each variant overwrites the token.

### 4.2 Collection variables

| Variable | Populated by |
|---|---|
| `baseUrl` | manual |
| `accessToken`, `refreshToken` | any **Login** / **Verify registration OTP** request |
| `registerEmail` | **Register** |
| `departmentId` | **Create department** (or the first row of **List departments**) |
| `categoryId` | **Create category** (or the first row of **List categories**) |
| `technicianUserId` | **Department technicians**, **Assign technician**, or **Register staff** |
| `complaintId` | **Create complaint** (either variant) |
| `resolvedComplaintId` | manual — the complaint to be moved to `RESOLVED` before feedback |
| `paymentId` | **Initiate payment** |
| `notificationId` | **My notifications** |

## 5. Local Development Reference

### 5.1 Commands

```bash
npm install
npm run dev            # tsx watch src/server.ts
npm run build          # tsc → dist/
npm start              # node dist/src/server.js
npm run linter:check   # biome lint
npm run linter:fix     # biome lint --write
npm run format:check   # biome format
```

### 5.2 Required environment variables

```dotenv
NODE_ENV=development
PORT=5000
DATABASE_URL="postgres://…"          # Prisma Postgres or any PostgreSQL
FRONTEND_URL=http://localhost:3000   # exact CORS origin (credentials: true)

BCRYPT_SALT_ROUNDS=10
JWT_ACCESS_SECRET=…   JWT_REFRESH_SECRET=…
JWT_ACCESS_EXPIRES_IN=1d              JWT_REFRESH_EXPIRES_IN=7d

GOOGLE_CLIENT_ID=…                    # audience for idToken verification

REDIS_USER=…  REDIS_PASSWORD=…  REDIS_HOST=…  REDIS_PORT=…

SMTP_USER=…  SMTP_PASSWORD=…  SMTP_EMAIL_SENDER=…

CLOUDINARY_CLOUD_NAME=…  CLOUDINARY_API_KEY=…  CLOUDINARY_API_SECRET=…

SUPER_ADMIN_NAME/EMAIL/PASSWORD      # seeded on first boot
TESTER_ADMIN_NAME/EMAIL/PASSWORD
TESTER_CITIZEN_NAME/EMAIL/PASSWORD
TESTER_TECHNICIAN_NAME/EMAIL/PASSWORD

BKASH_BASE_URL / BKASH_USERNAME / BKASH_PASSWORD /
BKASH_APP_KEY / BKASH_APP_SECRET / BKASH_CALLBACK_URL

STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_CURRENCY /
STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL / STRIPE_WEBHOOK_TOLERANCE
```
