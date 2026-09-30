# City Complaint & Service Request Platform — Backend

**API Reference, Architecture Overview & Code Audit Report**

| | |
|---|---|
| **Project** | `city-complaint-platform-backend` |
| **Stack** | Node.js · TypeScript 7 · Express 5 · Prisma 7 (PostgreSQL) · Redis · Zod 4 |
| **Integrations** | Cloudinary (uploads), Nodemailer/Gmail (OTP email), bKash Tokenized Checkout, Stripe Checkout, Google Identity Services |
| **Base URL (dev)** | `http://localhost:5000` |
| **API prefix** | `/api/v1` |
| **OpenAPI-style Postman collection** | [`city-complaint-platform.postman_collection.json`](../city-complaint-platform.postman_collection.json) |
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

### 4.3 Recommended happy-path order

```
1  Login (tester admin)          → admin token
2  Create department             → departmentId
3  Create category               → categoryId  (slaHours sets the SLA budget)
4  Login (tester technician)     → technician token
5  Login (tester citizen)        → citizen token  (keeps admin token in `technicianToken`)
6  Create complaint              → complaintId
7  My complaints                 → role scoping proof
8  Login (tester admin)
9  Assign technician             → status ASSIGNED
10 Login (tester technician)
11 Accept assignment             → status IN_PROGRESS
12 Change status → RESOLVED      → resolvedAt, SLA, notifications
13 Login (tester citizen)
14 Submit feedback               → closes complaint   ⚠ currently mis-targeted
15 Get feedback                  ⚠ currently mis-targeted
16 Initiate payment → Execute payment (bKash) → Refund (admin)
```

### 4.4 Failure probes included

| Request | Asserts |
|---|---|
| `00 - Health / Route not found probe` | `notFound` middleware returns structured 404 |
| `06 - Feedback (BROKEN ROUTE)` folder | documents the `mergeParams` defect in-line |
| `09 - Admin (routes NOT mounted -> 404)` folder | documents the unmounted-router defect in-line |

---

## 5. Code Audit Report

Every finding below was verified against the source. Line references are `file:line`.

### Severity summary

| Severity | Count | Impact |
|---|:--:|---|
| 🔴 Critical | 6 | Data integrity breach, non-functional endpoint, production outage risk |
| 🟠 High | 9 | Broken business rules, forced re-authentication, data exposure |
| 🟡 Medium | 15 | Inconsistent behaviour, wrong results, operational risk |
| 🔵 Low | 3 | Code hygiene, misleading schema surface |
| ⚫ Hardening | 7 | Missing defence-in-depth controls |

---

### Critical

#### BUG-01 · Feedback endpoints act on an arbitrary complaint

**Location:** `src/app.ts:47` · `src/app/module/feedback/feedback.controller.ts:17,32`

```ts
app.use("/api/v1/complaints/:id/feedback", FeedbackRoutes);
```

`feedback.route.ts` creates its router with a bare `Router()`. Express only propagates parent path parameters into a sub-router when `mergeParams: true` is set. Verified empirically against the installed Express 5:

```
mounted at /api/v1/complaints/:id/feedback
  → req.params inside the sub-router  ===  {}      // req.params.id === undefined
```

`FeedbackService` then queries `where: { id: undefined, deletedAt: null }`. Prisma strips `undefined` from `where`, so the filter degenerates to "any non-deleted complaint" and the endpoint reads or writes **the first row in the complaints table**, regardless of the URL.

**Impact:** cross-record write. A citizen can create feedback on, and close, somebody else's complaint.

**Fix**

```ts
// feedback.route.ts
const router = Router({ mergeParams: true });
```

**Verification**

```bash
node -e "const e=require('express'),a=e(),r=e.Router({mergeParams:true});
r.get('/',(q,s)=>s.json(q.params));
a.use('/c/:id/f',r);const L=a.listen(0,async()=>{console.log(
 await (await fetch('http://127.0.0.1:'+L.address().port+'/c/abc/f')).text());L.close();});"
# → {"id":"abc"}
```

---

#### BUG-02 · Stripe webhook is permanently unreachable

**Location:** `src/app/module/payment/payment.controller.ts:132-139` · `src/app.ts:32`

```ts
const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
if (!rawBody) throw new AppError(400, "Raw request body is required for Stripe signature verification");
```

`rawBody` is never assigned anywhere in the codebase — `app.ts` registers `express.json()` without a `verify` hook, so the parsed-and-discarded raw buffer is unavailable. Every call therefore fails with 400 before signature verification is even attempted, and Stripe payments can never be confirmed automatically.

**Impact:** Stripe payments stay `PENDING` forever unless the client polls `GET /payments/:id/status`.

**Fix** — capture the raw buffer, and register it **before** all other body parsers:

```ts
// app.ts
app.use(express.json({
  verify: (req, _res, buf) => { (req as Request & { rawBody?: Buffer }).rawBody = buf; },
}));
```

---

#### BUG-03 · Technicians can read the entire complaint book

**Location:** `src/app/module/complaint/complaint.service.ts:170-189`

```ts
if (actor.role === Role.TECHNICIAN) {
  return {
    ...rest,
    AND: [..., {
      OR: [
        { assignedTechnicianId: actor.userId },
        { departmentId: { not: null } },   // ← matches almost every complaint
      ],
    }],
  };
}
```

Nearly every complaint has a non-null `departmentId` (it is derived from the category at creation), so the second `OR` branch nullifies the first. A technician listing `/api/v1/complaints` or `/api/v1/complaints/search` receives every citizen's complaint — titles, descriptions, precise addresses and coordinates — regardless of department.

**Impact:** horizontal privilege escalation, PII disclosure.

**Fix** — scope by the technician's own department:

```ts
const technician = await prisma.technician.findUnique({
  where: { userId: actor.userId },
  select: { user: { select: { departmentId: true } } },
});

return {
  ...rest,
  AND: [
    ...,
    {
      OR: [
        { assignedTechnicianId: actor.userId },
        { departmentId: technician?.user.departmentId ?? "__none__" },
      ],
    },
  ],
};
```

---

#### BUG-04 · Production responses discard every error message

**Location:** `src/app/middleware/globalErrorHandler.ts:59-70`

```ts
message: config.node_env === "development" ? errorMessage : "Internal Server Error",
name:    config.node_env === "development" ? errorName    : "Internal Server Error",
```

The `statusCode` survives but the message is unconditionally replaced. Verified output for `new AppError(404, "Complaint not found")` under `NODE_ENV=production`:

```json
{ "success": false, "statusCode": 404, "name": "Internal Server Error", "message": "Internal Server Error" }
```

**Impact:** the API becomes undiagnosable in production; every 4xx looks identical to the client and to support.

**Fix** — mask only genuinely unexpected errors:

```ts
const isKnown = err instanceof AppError;
message: isKnown || config.node_env === "development" ? errorMessage : "Internal Server Error",
name:    isKnown || config.node_env === "development" ? errorName    : "Internal Server Error",
```

---

#### BUG-05 · Two `.env` variable names are never read (bKash is dead)

| `config/index.ts` reads | `.env` defines | Result |
|---|---|---|
| `APP_URL` (`:10`) | `BACKEND_URL` (`:18`) | `bak_url === undefined` |
| `BKASH_BASE_URL` (`:51`) | `BKASH_SENDBOX_URL` (`:60`) | `bkashIsConfigured() === false` → every bKash call returns 503 |

`GET /api/v1/payments/gateways` will report `bkash.configured: false` even though the sandbox credentials are present.

**Fix:** align the names in `.env` (or accept both in `config`), and add `BKASH_CALLBACK_URL` pointing at a real route — it is currently `http://localhost:5000/api/v1`, which is not an endpoint of this application.

---

#### BUG-06 · Redis client has no `error` listener

**Location:** `src/app/lib/redis.ts` (entire file)

```ts
export const redisClient = createClient({ /* ... */ });
```

node-redis v6 emits `error` on connection loss. With no listener registered, the `EventEmitter` contract turns it into an uncaught exception and the process terminates. `redisClient.connect()` in `server.ts:25` also aborts startup on a transient outage.

**Fix**

```ts
redisClient.on("error", (err) => console.error("[redis]", err.message));
redisClient.on("reconnecting", () => console.warn("[redis] reconnecting…"));
```

---

### High

| ID | Finding | Location |
|---|---|---|
| **BUG-07** | **Email templates break in production.** `path.join(process.cwd(), "src", "app", "templates", ...)` resolves against the source tree, but `npm run build` emits `dist/` and templates are never copied. Every OTP / verification email throws `ENOENT`. Fix: copy `templates/` into `dist/` on build, or resolve relative to `__dirname` and bundle the `.ejs` files. | `utils/sendEmail.ts:19-25` |
| **BUG-08** | **Partial refunds are silently ignored.** `toAmountString(value, fallback)` returns `new Decimal(value.toFixed(2))` whenever `value` is non-null, so the `fallback` branch is unreachable. In `refundPayment` the first argument is always `payment.amount`, hence a requested partial refund always refunds **100 %** on both bKash and Stripe. | `payment.service.ts:58-69`, `payment.service.ts:903` |
| **BUG-09** | **Token invalidation on rename / role change.** `checkAuth` matches the DB row on `{ id, email, name, role }`. Because `name` and `role` are JWT claims, calling `PATCH /users/profile-update` or having an admin change a role instantly 401s every existing token for that user. Fix: match on `{ id }` (or `{ id, email }`) only. | `middleware/checkAuth.ts:59-66` |
| **BUG-10** | **`status === "DELETED"` is never rejected.** `checkAuth` blocks `isDeleted` and `status === "BLOCKED"` but lets a user whose status was set to `DELETED` through (reachable via `PATCH /admin/users/:id/status`, which never sets `isDeleted`). | `middleware/checkAuth.ts:72-84` |
| **BUG-11** | **`/complaints/search` ignores `?search=`.** `{ ...req.query, search: req.query.q }` unconditionally overwrites `search`; when `q` is absent the key becomes `undefined` and the filter silently vanishes. | `complaint.controller.ts:111` |
| **BUG-12** | **`sla` filter corrupts pagination.** The SLA predicate is applied *after* `skip`/`take`, so the page returns fewer rows than `limit` while `meta.total` reports the unfiltered count. | `complaint.service.ts:381-389` |
| **BUG-13** | **`DELETE /complaints/:id` has no role guard.** The route inherits only the blanket `auth(...)` from `complaint.route.ts:16`, so an assigned **technician** can soft-delete the complaint. Add `auth(Role.CITIZEN, Role.ADMIN, Role.SUPER_ADMIN)` (or admin-only). | `complaint.route.ts:51` |
| **BUG-14** | **bKash webhook has no signature verification.** Both `/webhook/bkash` and `/webhook` are public and accept a bare `paymentID`; the handler then re-queries bKash and writes the result. Anyone who learns a `paymentID` can force a state sync. Verify the bKash `authorization` header HMAC. | `payment.route.ts:21,23` · `payment.service.ts:713-740` |
| **BUG-15** | **`payment_intent.succeeded` can never match a payment.** `findPaymentForStripeEvent` resolves the payment from `stripeSessionId`, then `stripePaymentIntentId`, then `metadata.paymentId`. A PaymentIntent object carries none of these (metadata is set on the Checkout Session, and `stripePaymentIntentId` is only written by `checkout.session.*` events), so the event always returns `ignored: true`. | `payment.service.ts:760-789`, `833-842` |

---

### Medium

| ID | Finding | Location |
|---|---|---|
| **BUG-16** | **Soft-delete + `@unique` makes names unrecoverable.** The duplicate checks deliberately skip soft-deleted rows (`existing && !existing.deletedAt`), but `Department.name`, `Department.code` and `Category.name` are `@unique` — the insert still fails with P2002. Either hard-delete or restore-and-update the existing row. | `department.service.ts:19-30`, `category.service.ts:8-16` |
| **BUG-17** | **`STRIPE_CURRENCY=BDT` will be rejected.** BDT is a Stripe *presentment-only* currency; `createCheckoutSession` charges in it. Charge in a presentment currency and settle to BDT. | `lib/stripe.ts:91` · `.env:69` |
| **BUG-18** | **`unreadCount` is computed then discarded.** `NotificationService.getMyNotifications` returns `{ data, meta, unreadCount }`; the controller forwards only `data` and `meta`. | `notification.service.ts:42`, `notification.controller.ts:13-19` |
| **BUG-19** | **List scope contradicts detail scope.** `getRoleScopedWhere` lets a technician *list* every department complaint, while `findComplaintOrThrow` rejects them with 403 on `/:id`, `/:id/updates`, `/notes`, `/attachments`. A technician sees an item they cannot open. | `complaint.service.ts:184` vs `:218-226` |
| **BUG-20** | **`multipart/form-data` complaint creation always fails** unless the entire body is packed into one `complaintPayload` JSON string field. Individual text fields arrive as strings and `latitude`/`longitude` use `z.number()`. Either coerce numerics or document the single-field contract loudly. | `complaint.controller.ts:18-33`, `complaint.validation.ts:23-33` |
| **BUG-21** | **`forUpdate` option is accepted then discarded.** `void options;` — the parameter exists purely for appearance, so concurrent status transitions are not serialised. Either implement `SELECT … FOR UPDATE` inside a transaction or remove it. | `complaint.service.ts:194-198, 228` |
| **BUG-22** | **Note `status` is decorative and unvalidated.** `addNote` writes `payload.status` onto the timeline row without touching `Complaint.status` and without checking the transition map, so notes can assert any state. | `complaint.service.ts:966` |
| **BUG-23** | **`assignTechnician` can fail with P2025.** It verifies a technician **user** exists (`include: { technician: true }`) but never asserts the Technician row, then calls `tx.technician.update({ where: { userId } })`. It also ignores `technician.isDeleted`. | `complaint.service.ts:715-724, 768-775` |
| **BUG-24** | **Cancelling skips the active-payment guard** that `deleteComplaint` performs, so a `PAID` complaint can be moved to `CANCELLED` without a refund. | `complaint.service.ts:520-532` vs `:893-898` |
| **BUG-25** | **`PATCH /admin/users/:id/status` with `DELETED` is cosmetic.** It writes `status` only; `isDeleted` / `deletedAt` stay `false`, so the account keeps working. Set all three, or restrict the enum. | `admin.service.ts:133-141` |
| **BUG-26** | **Feedback notifies the submitter.** `createFeedback` sends "Complaint closed" to `complaint.citizenId`, i.e. back to the citizen who just submitted the rating. | `feedback.service.ts:123-129` |
| **BUG-27** | **`changePassword` is weaker than every other password path.** `min(6)` with no complexity rule, while `register`, `register-staff` and `reset-password` all require 8+ with upper/lower/digit/special. | `user.validation.ts:48-51` vs `auth.validation.ts:169-172` |
| **BUG-28** | **`POST /register` accepts privileged fields.** The schema exposes `role`, `status`, `emailVerified`, `isDeleted`, `authProvider`, `needPasswordChange`. The service currently ignores them (no escalation today), but the surface is a trap for the next maintainer. Mark them `.optional()`-only-for-internal or strip with a whitelist DTO. | `auth.validation.ts:37-53` |
| **BUG-29** | **Duplicate authentication work.** `complaint.route.ts:16` registers `router.use(auth(...))` and `complaint.route.ts:20` registers a second `auth(...)` for `POST /`, performing two JWT verifications **and two identical DB lookups** per create. | `complaint.route.ts:16-23` |
| **BUG-30** | **`loginUser` can 500 on a passwordless account.** The guard only covers `password === null && googleId !== null`; the `password === null && googleId === null` case falls through to `bcrypt.compare(password, null as string)`. Reproduced: `bcryptjs` throws `Illegal arguments: string, object` (sync throw, not a rejected promise), so the async wrapper does **not** catch it and the process-level handler returns 500. | `auth.service.ts:234-244` |

---

### Low

| ID | Finding | Location |
|---|---|---|
| **BUG-31** | **Seeded citizen has no `Citizen` profile row.** `seedTesterCitizen` creates the user without the nested `citizen: { create: … }`, so `GET /auth/me` returns `citizen: null` for the primary test account. | `utils/seed.ts:130-137` |
| **BUG-32** | **Duplicated `sortBy` key in `buildOrderBy`.** When `sortBy === "createdAt"` (the default) the whitelist matches and the result is `[{ createdAt: order }, { createdAt: order }]`, emitting a redundant sort clause. | `utils/pagination.ts:41-44` |
| **BUG-33** | **`authProvider` is never updated on Google linking.** `googleLogin` writes only `googleId` when linking an existing credential account, leaving `authProvider: CREDENTIAL`. The `forgotPassword` guard is `googleId && authProvider === "GOOGLE"`, so a linked user is never told their account is Google-managed; the OTP flow runs normally and `resetPassword` overwrites `password`. Net effect is inconsistent account metadata rather than a lockout — but a Google-only user who later gets linked keeps the "wrong" provider flag. Also affects any future provider-aware branching. | `auth.service.ts:356-363`, `510`, `567` |

---

### Security & Hardening Gaps

| Gap | Detail | Recommendation |
|---|---|---|
| **No rate limiting** | `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password` and all webhook routes are unthrottled → credential stuffing and email bombing. | `express-rate-limit`, stricter limits on the auth router and per-IP limits on OTP sends. |
| **Account enumeration** | `/auth/forgot-password` returns four distinct messages for unknown / blocked / deleted / unverified accounts. | Return `200` with a constant message; log the real reason server-side. |
| **No token revocation** | `logout`, `reset-password` and `change-password` leave every issued JWT valid. There is no Redis blocklist and no `tokenVersion` column. | Store a `tokenVersion` on `User`, bump it on password change / logout; or keep a Redis deny-list keyed by `jti`. |
| **No security headers** | `helmet` is not used; no HSTS, `X-Content-Type-Options`, CSP or `Referrer-Policy`. | `app.use(helmet())`. |
| **Inconsistent password policy** | 6 chars via `/users/change-password` vs 8+complexity elsewhere (BUG-27). | Extract one shared Zod schema. |
| **No params/query validation** | `validateRequest` only parses `req.body`; `:id` values and query filters are trusted and cast (`status as ComplaintStatus`, `priority as Priority`). A bogus `?status=NOPE` reaches Prisma. | Add `validateRequest({ params, query, body })` or a `parseUuid` guard middleware. |
| **Live secrets in `.env`** | `.env` is correctly git-ignored (verified: not tracked by git), but it holds a live Prisma Postgres URL, Redis credentials, a Gmail app password, the Cloudinary API secret and a Stripe test secret. | Rotate if the file was ever pushed or shared; ship a `.env.example` with empty values. |

---

### Dead Code & Duplication

| Item | Location | Note |
|---|---|---|
| `AdminRoutes` never mounted | `app.ts:50` | 6 fully implemented endpoints are unreachable |
| `ComplaintStatusArray` | `admin/validation.ts:30` | Exported, never imported |
| `options: { forUpdate?: boolean }` | `complaint.service.ts:197` | Accepted then `void`ed |
| `const { payment: _outcome }` | `payment.service.ts:919` | Destructured and discarded |
| `sendEmail.ts` logging | `nodemailer` transporter has no `transporter.verify()` at boot | Connection failures surface only on the first OTP |
| `updateUserValidationSchema` | `auth/validation.ts:103-122` | Never referenced by any route |
| Duplicate bKash webhook route | `payment.route.ts:21` vs `:23` | Identical handler mounted twice |
| Biome warnings | 49 `lint/style/noNonNullAssertion` + others | Mostly `config/index.ts`; run `npm run linter:fix` |

---

## 6. Remediation Roadmap

### Phase 1 — Correctness & security (immediate)

1. **BUG-01** → `Router({ mergeParams: true })` in `feedback.route.ts`. *(highest severity-to-effort ratio)*
2. **BUG-02** → add the `express.json({ verify })` raw-body hook in `app.ts`.
3. **BUG-03** → scope technician visibility to `assignedTechnicianId OR departmentId = <own department>`.
4. **BUG-04** → preserve `AppError` messages and names in production.
5. **BUG-06** → register Redis `error` / `reconnecting` listeners; make Redis startup non-fatal.
6. **BUG-05** → align `.env` names with `config/index.ts`; add a startup config validator that fails fast on missing required variables.
7. **BUG-13 / BUG-14** → add the missing role filter to `DELETE /complaints/:id`; verify the bKash `authorization` HMAC.

### Phase 2 — Business-rule integrity

8. **BUG-08** → fix `toAmountString` fallback semantics and honour `payload.amount` for partial refunds.
9. **BUG-09 / BUG-10** → match the user by `id` only; reject `status === "DELETED"`.
10. **BUG-12** → move the SLA predicate into the Prisma `where` clause (or drop `sla` from the paginated list and expose it as a separate aggregate).
11. **BUG-11 / BUG-22** → accept both `q` and `search`; validate or remove the note `status`.
12. **BUG-16 / BUG-25** → unify soft-delete with uniqueness (restore-and-update, or a partial unique index on `deletedAt IS NULL`).

### Phase 3 — Operational readiness

13. **BUG-07** → copy `templates/` into `dist/` (or resolve from `__dirname`); add `transporter.verify()` at boot.
14. **BUG-17** → switch `STRIPE_CURRENCY` to a presentment currency.
15. **BUG-15** → persist `stripePaymentIntentId` at checkout creation so intent-level events resolve.
16. Add `express-rate-limit`, `helmet`, and a Redis-backed token deny-list or `tokenVersion`.
17. Replace the whitelist-free `/register` schema with an explicit DTO (BUG-28).

### Phase 4 — Quality

18. Introduce a test suite — `npm test` currently exits 1 with *"no test specified"*. Priority targets: `checkAuth`, the complaint state machine, payment status derivation, and the feedback route wiring.
19. Remove dead code (BUG-31-33 section of the table) and run `npm run linter:fix`.
20. Add `sortBy`/`sortOrder`/param validation for every list endpoint.

---

## 7. Local Development Reference

### 7.1 Commands

```bash
npm install
npm run dev            # tsx watch src/server.ts
npm run build          # tsc → dist/
npm start              # node dist/src/server.js
npm run linter:check   # biome lint
npm run linter:fix     # biome lint --write
npm run format:check   # biome format
```

### 7.2 Required environment variables

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

> `BKASH_SENDBOX_URL` and `BACKEND_URL` in the current `.env` are **not read** by `config/index.ts` — see [BUG-05](#critical).

### 7.3 Bootstrap sequence (`server.ts`)

```
prisma.$connect()
  → seedSuperAdmin() → seedTesterAdmin() → seedTesterCitizen() → seedTesterTechnician()
redisClient.connect()
app.listen(PORT)
```

All seeds are idempotent (email/role existence checks) and swallow their own errors, so a missing credential logs instead of failing the boot. Department and category seeding is commented out (`seedDepartmentsAndCategories`) and must be done through the API.

### 7.4 Local webhook tunnels

```bash
stripe listen --forward-to localhost:5000/api/v1/payments/webhook/stripe
```

Copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`. Note that the endpoint is currently broken by BUG-02, so use `GET /api/v1/payments/:id/status` to reconcile state until it is fixed.

---

## 8. Verification Appendix

Every command below was executed against the repository so the findings above are reproducible rather than asserted.

### 8.1 Collection integrity

```bash
node -e "const c=require('./city-complaint-platform.postman_collection.json');
         const n=f=>f.item.reduce((a,i)=>a+(i.item? n(i):1),0);
         console.log(c.info.schema, n(c), c.item.length);"
```

```
https://schema.getpostman.com/json/collection/v2.1.0/collection.json  67  10
```

`git ls-files --error-unmatch city-complaint-platform.postman_collection.json` → tracked, and `git check-ignore` → not ignored. Working tree is clean except for the new `docs/` directory.

### 8.2 BUG-01 — mounted-router params (Express 5, live)

```bash
node -e "const e=require('express'),a=e(),r=e.Router();
r.get('/',(q,s)=>s.json({params:q.params,url:q.originalUrl}));
a.use('/api/v1/complaints/:id/feedback',r);
const L=a.listen(0,async()=>{console.log(await (await fetch(
 'http://127.0.0.1:'+L.address().port+'/api/v1/complaints/abc-123/feedback')).text());
 L.close();});"
```

```json
{ "params": {}, "url": "/api/v1/complaints/abc-123/feedback" }
```

Control run with `Router({ mergeParams: true })` returns `{"id":"abc-123"}`.

### 8.3 BUG-02 — Stripe raw body

`Select-String -Path src -Pattern "rawBody"` matches **only** the read site in `payment.controller.ts`. No `verify` hook, no assignment, no `rawBody` declaration anywhere else in `src/` — the field is permanently `undefined`.

### 8.4 BUG-30 — bcrypt with a null hash (live)

```bash
node -e "require('bcryptjs').compare('x', null).then(r=>console.log(r)).catch(e=>console.log('THREW:',e.message))"
```

```
THREW: Illegal arguments: string, object
```

`bcryptjs` throws **synchronously** on a non-string hash, so the surrounding `try/catch` in `asyncWrapper` never sees a rejected promise.

### 8.5 BUG-05 — `.env` inventory (keys only, values redacted)

| Line | Key | Read by `config/index.ts`? |
|---|---|---|
| 18 | `BACKEND_URL` | ✗ (`APP_URL`) |
| 20 | `FRONTEND_URL` | ✓ |
| 60 | `BKASH_SENDBOX_URL` | ✗ (`BKASH_BASE_URL`) |
| 65 | `BKASH_CALLBACK_URL` | ✓ — value is `http://localhost:5000/api/v1`, not a route of this app |
| 69 | `STRIPE_CURRENCY` | ✓ — value `BDT` is presentment-only (BUG-17) |

### 8.6 Line references confirmed by targeted read

| Claim | Verified evidence |
|---|---|
| BUG-01 | `feedback.route.ts:8` → `const router = Router();` |
| BUG-06 | `app.ts:50` → `// app.use("/api/v1/admin", AdminRoutes);` (commented out) |
| BUG-28 | `auth.validation.ts:12` `createUserValidationSchema`; privileged keys at `:37-53` |
| BUG-32 | `pagination.ts:41-44` → `[{ [sortBy]: order }, { createdAt: order }]`; default `sortBy = "createdAt"` at `:19` |
| BUG-31 | `seed.ts:129-137` → `prisma.user.create` with no nested `citizen: { create }` |
| Dead code | `seed.ts:204` → `// export const seedDepartmentsAndCategories = async () => {` (commented out) |
| BUG-33 | `auth.service.ts:356-363` sets `googleId` only; guards at `:510` and `:567` read `authProvider` |
| BUG-30 | `auth.service.ts:230` already rejects `status === DELETED` for **login**; only `checkAuth` omits it (BUG-10) |

### 8.7 Build state

```bash
npx tsc --noEmit                          # clean, no output
npx @biomejs/biome lint ./src             # 49 warnings, 0 errors
```

The warnings are dominated by `lint/style/noNonNullAssertion`, concentrated in `src/app/config/index.ts` — consistent with the unvalidated `.env` contract described in BUG-05. `npm test` is a placeholder (`echo "Error: no test specified" && exit 1`), so **no automated regression test exists** for any fix in Phase 1 of the roadmap. Add tests for the feedback route wiring, the complaint state machine, payment status derivation, and `checkAuth` before shipping any of them.

---

*End of report.*
