# City Complaint & Service Request Platform — Backend 

A RESTful backend API for managing city complaints and public service requests.

Citizens submit complaints, staff investigate and resolve them, and administrators manage users, departments, categories, assignments and payments.

> **📖 Endpoint reference:** all 64 endpoints are listed in [Main API Endpoints](#-main-api-endpoints) with role restrictions and query parameters, and every one of them ships as a ready-to-run request in [`postman/CityComplaint.postman_collection.json`](postman/CityComplaint.postman_collection.json) — see [API Testing](#-api-testing).

---

## 🚀 Project Overview

The platform digitises communication between citizens and city service departments. Instead of reporting problems such as road damage, garbage collection, water supply issues, street light problems or drainage issues by hand, citizens submit them through the API.

The system routes each complaint to the appropriate category and department, then lets staff investigate, update status and resolve the issue.

### 🔄 Complaint Workflow

```text
Citizen
   │
   ▼
Create Complaint / Request
   │
   ▼
Select Category & Location
   │
   ▼
Department Assignment
   │
   ▼
Staff Assignment
   │
   ▼
Investigation / Work
   │
   ▼
Status Update
   │
   ▼
Resolution
   │
   ▼
Citizen Feedback
```

---

## ✨ Key Features

### 🔐 Authentication & Security

- Email & password registration with email OTP verification
- Email & password login
- Google OAuth / GCP social login
- JWT authentication (access token + refresh token)
- Secure password hashing with bcrypt
- Forgot password, reset password, change password, logout
- Protected routes and role-based authorization
- CORS locked to a single configured origin (`FRONTEND_URL`) with credentials enabled
- HTTP-only auth cookies alongside `Authorization` headers
- Stripe webhook signatures verified against the raw request body
- No rate limiter is mounted yet — see [Rate Limiting](#️-rate-limiting)

### 👥 Role-Based Access Control

| Role            | Responsibilities                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| **CITIZEN**     | Create and manage own complaints, track status, submit feedback                                       |
| **TECHNICIAN**  | Manage assigned complaints, accept assignments, investigate issues, update status, add notes          |
| **ADMIN**       | Manage users, departments, categories, assignments, payments, reports and system activities           |
| **SUPER_ADMIN** | Everything an ADMIN can do, plus user role management and full access to all system resources |

### 💳 Payments

- Complaint service fees collected through **bKash** (tokenized checkout) or **Stripe** (Checkout Session), chosen per payment
- Gateway selection on `POST /api/v1/payments/initiate` with `gateway: "bkash" | "stripe"`
- Redirect URLs returned to the client (`bkashURL` / `checkoutUrl`)
- Signed Stripe webhook with raw-body HMAC verification, timestamp tolerance and event de-duplication
- Status reconciliation endpoint as a fallback when a gateway callback is missed
- Admin refunds routed back to the gateway that collected the payment
- In-app notifications and audit log entries for every payment state change

---

## 🏙️ Complaint Management

Citizens can:

- Create complaints (with image attachments)
- View their own complaints
- View complaint details and status timeline
- Update complaints while they are still `SUBMITTED` or `UNDER_REVIEW`
- Cancel complaints that are still active
- Submit feedback after resolution

Staff (Technicians) can:

- View complaints assigned to them
- Accept assignments
- Update complaint status
- Add investigation notes
- Mark complaints as resolved

Admins can:

- View and filter all complaints
- Assign complaints to technicians
- Change complaint status
- Monitor SLA status
- Manage complaint workflows

---

## 🏢 Department Management

Administrators manage city departments. The following departments are seeded on first startup:

| Department         | Code    | Seeded categories                             |
| ------------------ | ------- | --------------------------------------------- |
| Road & Transport   | `ROAD`  | Road Damage (72h), Footpath Repair (120h)      |
| Waste Management   | `WASTE` | Garbage Collection (48h), Drainage Cleaning (48h) |
| Water & Sewerage   | `WATER` | Water Supply (48h), Sewerage (72h)            |
| Electricity        | `ELEC`  | Street Light (48h), Power Outage (24h)         |
| Public Health      | `HEALTH`| Public Health (96h)                            |

Each category carries an `slaHours` value that drives SLA tracking, and is mapped to a department so complaints route automatically.

---

## 📍 Location Management

Complaints capture location information so city staff can identify where the issue occurred:

- Address
- Area
- Ward number
- Latitude
- Longitude

---

## 📊 Complaint Status Workflow

The complaint lifecycle follows a controlled status workflow with server-enforced transitions.

```text
SUBMITTED → UNDER_REVIEW → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED
```

A complaint may also end in `REJECTED` or `CANCELLED`.

| Role               | Allowed Transitions                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------- |
| **ADMIN / SUPER_ADMIN** | `SUBMITTED → UNDER_REVIEW`, `SUBMITTED → REJECTED`, `UNDER_REVIEW → REJECTED`, `RESOLVED → CLOSED` |
| **TECHNICIAN**     | `ASSIGNED → IN_PROGRESS`, `IN_PROGRESS → RESOLVED` (assigned technician only)                |

Citizens can cancel complaints in `SUBMITTED`, `UNDER_REVIEW`, `ASSIGNED` or `IN_PROGRESS`, and can edit complaints while in `SUBMITTED` or `UNDER_REVIEW`.

---

## 📎 File & Image Attachments

Citizens can attach up to 5 images per upload to complaints.

```text
Road damage
     ↓
Upload road image
     ↓
Cloudinary
     ↓
Complaint attachment
```

> Uploads use Multer memory storage and are streamed to Cloudinary. Multer is configured with a **5MB per-file** and **5 files per-request** ceiling and an image-only MIME filter (`jpeg`, `png`, `webp`, `gif`, `avif`) — see `src/app/lib/multer.ts`. Unsupported types are rejected with `415` and oversize or excess files with `400`. Raise `MAX_FILE_SIZE_BYTES` / `MAX_FILES_PER_REQUEST` there if you need to.

---

## ⭐ Citizen Feedback

After a complaint is resolved, feedback can be submitted:

```json
{
  "rating": 5,
  "comment": "The issue was resolved quickly."
}
```

---

## 🔔 Notifications

In-app notifications are created for important complaint events:

- Complaint created
- Complaint assigned
- Staff assigned
- Status changed
- Complaint resolved
- Complaint rejected

---

## ⏱️ SLA Tracking

Each category defines an expected resolution time in hours. SLA state is computed against the complaint's `slaDeadline`.

| State               | Condition                                          |
| ------------------- | -------------------------------------------------- |
| `PENDING`           | No deadline set                                    |
| `ON_TRACK`          | Open, deadline not yet within the approach window  |
| `APPROACHING`       | Open, less than 25% of the SLA window remaining    |
| `BREACHED`          | Open, deadline has passed                          |
| `COMPLETED_ON_TIME` | Resolved/closed on or before the deadline          |
| `COMPLETED_LATE`    | Resolved/closed after the deadline                 |

Each complaint response is decorated with an `sla` object containing `slaStatus`, `slaDeadline`, `resolvedAt`, `remainingHours` and `isSlaBreached`.

> The `?sla=` filter is applied in memory **after** pagination, so `meta.total` reflects the unfiltered count. Prefer filtering by `status` or `priority` when you need consistent totals.

---

## 💳 Payment Integration

Complaint service fees are collected through two interchangeable gateways: **bKash** (tokenized checkout) and **Stripe** (Checkout). The client picks one per payment with `"gateway": "bkash" | "stripe"` on `POST /payments/initiate`; everything after that — the payment record, notifications, audit trail and refunds — is shared.

### Gateway flows

```text
POST /api/v1/payments/initiate  (gateway: bkash)
      ↓
bKash Create Payment API
      ↓
bKash Checkout URL (bkashURL)
      ↓
Customer pays on bKash
      ↓
bKash Execute / Webhook / Query
      ↓
Backend Verification
      ↓
Update Payment Status (PENDING → PAID / FAILED)
```

```text
POST /api/v1/payments/initiate  (gateway: stripe)
      ↓
Stripe Checkout Session API
      ↓
Stripe Checkout URL (checkoutUrl)
      ↓
Customer pays on Stripe
      ↓
POST /api/v1/payments/webhook/stripe  (signed)
      ↓
Signature verification → Update Payment Status (PENDING → PAID / FAILED / CANCELLED)
```

### bKash

| Step | Endpoint | Notes |
| --- | --- | --- |
| Create session | `POST /api/v1/payments/initiate` | Returns `bkashURL` to redirect the citizen to |
| Capture | `POST /api/v1/payments/:id/execute` | Calls the bKash execute API, then marks the record `PAID` / `FAILED` |
| Gateway callback | `POST /api/v1/payments/webhook/bkash` | Public. Re-queries the bKash status API and finalises the payment |
| Reconcile | `GET /api/v1/payments/:id/status` | Manual status sync when a callback was missed |
| Refund | `POST /api/v1/payments/:id/refund` | Uses the bKash refund API with `trxID` |

The access token is granted through `/tokenized/checkout/token/grant` and cached in Redis under `bkash:access-token` for `expires_in - 60` seconds. `POST /api/v1/payments/webhook` is kept as a bKash alias for `POST /api/v1/payments/webhook/bkash`.

### Stripe

| Step | Endpoint | Notes |
| --- | --- | --- |
| Create session | `POST /api/v1/payments/initiate` | Returns `sessionId` and `checkoutUrl` |
| Webhook | `POST /api/v1/payments/webhook/stripe` | Public. **Raw body + `Stripe-Signature` HMAC verification** |
| Reconcile | `GET /api/v1/payments/:id/status` | Retrieves the Checkout Session and syncs the record |
| Refund | `POST /api/v1/payments/:id/refund` | Refunds the Stripe PaymentIntent |

Handled Stripe events:

| Event | Effect |
| --- | --- |
| `checkout.session.completed` | `PAID` when `payment_status` is `paid` |
| `checkout.session.async_payment_succeeded` | `PAID` |
| `checkout.session.expired` | `CANCELLED` |
| `payment_intent.succeeded` | `PAID` |
| `payment_intent.payment_failed` / `payment_intent.canceled` | `FAILED` |
| `charge.refunded` | `REFUNDED` |
| anything else | acknowledged with `ignored: true`, no state change |

Webhook behaviour:

- The raw request body is captured in `app.ts` (`express.json({ verify })`) so the HMAC can be checked against the exact bytes Stripe signed. A missing, stale (> `STRIPE_WEBHOOK_TOLERANCE` seconds, default 300) or invalid `Stripe-Signature` is rejected with `400`.
- Deliveries are de-duplicated by `event.id` (Redis `NX` marker with a 7 day TTL, falling back to the `stripeEventId` column), and a payment that already reached a terminal state is never downgraded.
- The payment is resolved from the Checkout Session id, the PaymentIntent id or `metadata.paymentId` — whichever the event carries.

Local webhook testing:

```bash
stripe listen --forward-to localhost:5000/api/v1/payments/webhook/stripe
stripe trigger checkout.session.completed
```

Copy the printed `whsec_...` signing secret into `STRIPE_WEBHOOK_SECRET`.

### Shared behaviour

- Payment statuses: `PENDING`, `PAID`, `FAILED`, `CANCELLED`, `REFUNDED`.
- One payment row per attempt, discriminated by `paymentGateway` (`bkash` / `stripe`) and the gateway reference columns (`bkashPaymentId`, `bkashTrxId`, `stripeSessionId`, `stripePaymentIntentId`, `stripeEventId`).
- `GET /api/v1/payments/gateways` reports which gateways the running instance has credentials for.
- Real gateway calls are used — there is no simulated payment path. `initiate` returns `503` when the selected gateway is not configured, so no orphan `PENDING` rows are created.
- Refunds are admin-only (`ADMIN`, `SUPER_ADMIN`), limited to `PAID` payments, and routed to the gateway that collected the money.


---

## 📝 Audit Logs

Critical system activities are recorded:

```text
User role changed
Complaint assigned
Complaint status changed
Department created
Category updated
Complaint deleted
Staff assigned
```

Example audit record:

```json
{
  "action": "COMPLAINT_STATUS_UPDATED",
  "userId": "user-id",
  "resourceId": "complaint-id",
  "oldValue": "IN_PROGRESS",
  "newValue": "RESOLVED"
}
```

Audit writes are best-effort: failures are swallowed so logging can never break the primary request flow.

---

# 🛠️ Technology Stack

| Technology             | Purpose                             |
| ---------------------- | ----------------------------------- |
| **Node.js**            | Runtime                             |
| **TypeScript**         | Type safety                         |
| **Express.js (v5)**    | REST API framework                  |
| **PostgreSQL**         | Relational database                 |
| **Prisma ORM (v7)**    | Database access & relations         |
| **Zod (v4)**           | Request validation                  |
| **JWT**                | Authentication                      |
| **bcryptjs**           | Password hashing                    |
| **Google OAuth / GCP** | Social authentication               |
| **Redis**              | Caching / OTP / temporary state     |
| **Cloudinary**         | File & image storage                |
| **bKash Gateway**      | Payment processing (bKash)           |
| **Stripe**             | Payment processing (Checkout + webhooks) |
| **Nodemailer + EJS**   | Email notifications with templates  |
| **Multer**             | Multipart file upload handling      |
| **Biome**              | Lint & format                       |
| **tsup**               | Build                               |
| **Postman**            | API testing & documentation         |
| **Vercel**             | Deployment                          |

---

# 🏗️ Project Architecture

```text
src/
│
├── app/
│   ├── config/              # Environment configuration
│   ├── lib/                 # prisma, redis, nodemailer, multer, cloudinary, bkash, stripe, googleAuth
│   ├── middleware/          # checkAuth, validateRequest, globalErrorHandler, notFound
│   ├── module/              # Feature modules
│   ├── templates/           # EJS email templates
│   └── utils/               # AppError, catchAsync, sendResponse, jwt, authCookie, pagination,
│                            #   sla, auditLog, notify, cache, seed, sendEmail
│
├── generated/prisma/        # Prisma client (generated — do not edit)
│
├── app.ts                   # Express app
└── server.ts                # HTTP server + seeding

postman/
└── CityComplaint.postman_collection.json   # Generated — see scripts/build-postman.mjs

scripts/
└── build-postman.mjs        # Regenerates the Postman collection from the routers
```

Each module follows a consistent pattern:

```text
module/<name>/
├── <name>.route.ts         # Express router (endpoints + auth + validation)
├── <name>.controller.ts    # Request/response handling
├── <name>.service.ts       # Business logic & Prisma queries
├── <name>.validation.ts    # Zod schemas
└── <name>.interface.ts     # TypeScript types
```

The `auth` module is the one exception — it uses `auth.router.ts` instead of `auth.route.ts`.

Feature modules: `auth`, `user`, `department`, `category`, `complaint`, `feedback`, `notification`, `payment`, `admin`.

### Request Flow

```text
Client
  ↓
Route
  ↓
Authentication Middleware (auth)
  ↓
Authorization (role check)
  ↓
Validation Middleware (Zod)
  ↓
Controller
  ↓
Service
  ↓
Prisma
  ↓
PostgreSQL
  ↓
Response
```

---

# 🔐 API Authentication

Protected endpoints accept a Bearer token:

```http
Authorization: Bearer <access_token>
```

Tokens may also be sent as HTTP-only cookies named `accessToken` and `refreshToken`. The cookie is preferred when both are present.

| Cookie         | Lifetime | Flags                     |
| -------------- | -------- | ------------------------- |
| `accessToken`  | 1 day    | `httpOnly`, `SameSite=None` + `Secure` in production, `SameSite=Lax` in development |
| `refreshToken` | 7 days   | same flags                |

> Cookie flags are derived from `NODE_ENV` in `src/app/utils/authCookie.ts`. Browsers reject a `SameSite=None` cookie that is not also `Secure`, so production **must** run with `NODE_ENV=production` behind HTTPS — otherwise both auth cookies are silently dropped.

Users with `BLOCKED` status receive `403 Forbidden` on every authenticated request.

Example:

```http
GET /api/v1/auth/me

Authorization: Bearer eyJhbGciOiJIUzI1Ni...
```

---

# 📡 API Versioning

All APIs use versioned routes under `/api/v1`.

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
GET  /api/v1/auth/me
POST /api/v1/complaints
```

---

# 📋 API Response Format

All APIs follow a consistent response structure, produced by `sendResponse` (`src/app/utils/sendResponse.ts`).

### Success Response

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Operation successful",
  "data": {},
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 0,
    "totalPages": 0
  }
}
```

- `meta` is only present on paginated list endpoints.
- `extra` is supported by the `sendResponse` type and is **spread into the root object**, not nested under an `extra` key. It is currently unused by any endpoint.

### Error Response

```json
{
  "success": false,
  "statusCode": 400,
  "name": "Error",
  "message": "Invalid email format",
  "error": { "statusCode": 400 },
  "stack": "Error: Invalid email format\n    at ..."
}
```

`name`, `message`, `error` and `stack` are only serialised when `NODE_ENV=development`. In production the real `statusCode` is preserved but `name` and `message` become `"Internal Server Error"` — so branch on `statusCode`, never on `message`.

Unmatched routes return the same envelope:

```json
{
  "success": false,
  "statusCode": 404,
  "message": "Route not found: GET /api/v1/nope",
  "data": null
}
```

---

# 🔑 Main API Endpoints

## Server & Health

```http
GET  /                                # Welcome message
GET  /api/v1/health                   # Health check (uptime + timestamp)
```

## Authentication

```http
POST /api/v1/auth/register               # Citizen registration (OTP sent to email)
POST /api/v1/auth/register-email-verify  # Verify OTP to complete registration
POST /api/v1/auth/login                  # Email & password login
POST /api/v1/auth/google                 # Google OAuth login (idToken)
GET  /api/v1/auth/me                     # Current user profile (all roles)
POST /api/v1/auth/refresh-token          # Get new tokens from refresh cookie
POST /api/v1/auth/forgot-password        # Request password reset OTP
POST /api/v1/auth/reset-password         # Reset password with OTP
POST /api/v1/auth/logout                 # Logout (clears cookies)
POST /api/v1/auth/register-staff         # ADMIN/SUPER_ADMIN: create staff/technician
```

## User Profile

```http
PATCH /api/v1/users/profile-image-upload  # multipart/form-data, field: profile-image
PATCH /api/v1/users/profile-update        # Update name, phone, citizen profile (nid, address, wardNo, area)
PATCH /api/v1/users/change-password       # Change own password
```

## Departments

```http
POST   /api/v1/departments                    # ADMIN/SUPER_ADMIN
GET    /api/v1/departments                    # List (all roles, pagination + search + filters)
GET    /api/v1/departments/:id                # Detail (all roles)
GET    /api/v1/departments/:id/technicians    # ADMIN/SUPER_ADMIN/TECHNICIAN
POST   /api/v1/departments/:id/manager        # ADMIN/SUPER_ADMIN: assign manager { userId }
PATCH  /api/v1/departments/:id                # ADMIN/SUPER_ADMIN
DELETE /api/v1/departments/:id                # ADMIN/SUPER_ADMIN (soft delete)
```

## Categories

```http
POST   /api/v1/categories        # ADMIN/SUPER_ADMIN
GET    /api/v1/categories        # List categories (all roles)
GET    /api/v1/categories/:id    # Detail (all roles)
PATCH  /api/v1/categories/:id    # ADMIN/SUPER_ADMIN
DELETE /api/v1/categories/:id    # ADMIN/SUPER_ADMIN (soft delete)
```

## Complaints (all require authentication)

Every route in this module is authenticated for all four roles; the notes below list any *additional* restriction.

```http
POST   /api/v1/complaints                  # CITIZEN/ADMIN/SUPER_ADMIN (multipart: complaintPayload + images)
GET    /api/v1/complaints                  # List all (role-scoped)
GET    /api/v1/complaints/my-complaints    # CITIZEN only
GET    /api/v1/complaints/my-assigned      # TECHNICIAN only
GET    /api/v1/complaints/search           # Search with ?q=
GET    /api/v1/complaints/:id/updates      # Complaint timeline/updates
GET    /api/v1/complaints/:id
PATCH  /api/v1/complaints/:id              # CITIZEN: only while SUBMITTED/UNDER_REVIEW
DELETE /api/v1/complaints/:id              # Soft delete
PATCH  /api/v1/complaints/:id/status       # ADMIN/SUPER_ADMIN/TECHNICIAN
POST   /api/v1/complaints/:id/assign       # ADMIN/SUPER_ADMIN: assign technician
POST   /api/v1/complaints/:id/accept       # TECHNICIAN: accept assignment
POST   /api/v1/complaints/:id/cancel       # Cancel an active complaint
POST   /api/v1/complaints/:id/notes        # Add investigation note
POST   /api/v1/complaints/:id/attachments  # Upload images (multipart: images, max 5)
```

> `POST /api/v1/complaints` and `POST /api/v1/complaints/:id/attachments` use
> `multipart/form-data`. Complaint fields are sent as a JSON string in a
> `complaintPayload` form field (or as individual form fields) plus an optional
> `images` file input (max 5 files).

## Feedback

```http
POST /api/v1/complaints/:id/feedback   # CITIZEN/ADMIN/SUPER_ADMIN, after complaint is RESOLVED/CLOSED
GET  /api/v1/complaints/:id/feedback   # All roles
```

## Notifications (all require authentication)

```http
GET    /api/v1/notifications
PATCH  /api/v1/notifications/read-all
PATCH  /api/v1/notifications/:id/read
```

## Payments

```http
GET    /api/v1/payments/gateways      # Public: supported gateways + configured flag
POST   /api/v1/payments/initiate      # CITIZEN/ADMIN/SUPER_ADMIN: start a bKash or Stripe payment
POST   /api/v1/payments/webhook/bkash # Public: bKash callback (paymentID in body or query)
POST   /api/v1/payments/webhook/stripe# Public: Stripe callback (signed raw body)
POST   /api/v1/payments/webhook       # Public: bKash alias of /webhook/bkash
GET    /api/v1/payments/my-payments   # Own payments (all roles, filter: status, gateway)
GET    /api/v1/payments/admin/all     # ADMIN/SUPER_ADMIN: all payments (filter: status, gateway, complaintId)
POST   /api/v1/payments/:id/execute   # CITIZEN/ADMIN/SUPER_ADMIN: bKash capture after redirect
GET    /api/v1/payments/:id/status    # Query gateway status (bKash API / Stripe session)
POST   /api/v1/payments/:id/refund    # ADMIN/SUPER_ADMIN: refund on the original gateway
GET    /api/v1/payments/:id
```

Request body for `POST /api/v1/payments/initiate` (JSON):

```json
{
  "gateway": "stripe",
  "complaintId": "<complaint-uuid>",
  "amount": 500,
  "successURL": "https://app.example.com/payments/success",
  "cancelURL": "https://app.example.com/payments/cancelled",
  "callbackURL": "https://api.example.com/api/v1/payments/webhook/bkash"
}
```

| Field | Gateway | Required | Description |
| --- | --- | --- | --- |
| `gateway` | both | no | `bkash` (default) or `stripe` |
| `complaintId` | both | yes | Complaint the fee belongs to; a citizen can only pay for their own complaint |
| `amount` | both | no | Only needed when the complaint has no `serviceFee` yet |
| `callbackURL` | bKash | no | Defaults to `BKASH_CALLBACK_URL` |
| `successURL` / `cancelURL` | Stripe | no | Default to `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` |


## Admin (ADMIN/SUPER_ADMIN)

```http
GET   /api/v1/admin/users                        # List users (search/filter)
PATCH /api/v1/admin/users/:id/status             # Block/unblock etc.
PATCH /api/v1/admin/users/:id/role               # SUPER_ADMIN only
PATCH /api/v1/admin/users/:id/department         # Assign staff to department
GET   /api/v1/admin/dashboard-stats              # Cached dashboard statistics
GET   /api/v1/admin/audit-logs                   # List audit logs
```

---

# 🛡️ Rate Limiting

**Not implemented.** `src/app.ts` mounts no `express-rate-limit` instance, so every endpoint is currently unlimited and `X-RateLimit-*` headers are never sent. `express-rate-limit` is listed in `package.json` but never imported.

The intended design, once added, is:

| Scope          | Window     | Limit |
| -------------- | ---------- | ----- |
| `/api/v1`      | 15 minutes | 300   |
| `/api/v1/auth` | 15 minutes | 20    |

Until then, put a limiter in front of the service (reverse proxy, API gateway) if you expose it publicly, and keep brute-force protection on `/auth/login`, `/auth/refresh-token`, `/auth/register-email-verify`, `/auth/forgot-password` and `/auth/reset-password` in mind.

---

# 🔎 Search, Filtering & Pagination

List APIs (`departments`, `complaints`, `notifications`, `payments`, `admin/users`, `admin/audit-logs`) support pagination and sorting.

Defaults: `page=1`, `limit=10`, `sortBy=createdAt`, `sortOrder=desc`. `limit` is capped at **100**.

```http
GET /api/v1/complaints?page=1&limit=10
```

`sortBy` is validated against a per-endpoint allowlist; unknown values fall back to `createdAt`. Complaints allow `createdAt`, `updatedAt`, `priority`, `status`.

Filtering on complaints:

```http
GET /api/v1/complaints?status=IN_PROGRESS
GET /api/v1/complaints?priority=HIGH
GET /api/v1/complaints?categoryId=uuid&departmentId=uuid
GET /api/v1/complaints?sla=BREACHED        # PENDING | ON_TRACK | APPROACHING | BREACHED | COMPLETED_ON_TIME | COMPLETED_LATE
```

Sorting:

```http
GET /api/v1/complaints?sortBy=createdAt&sortOrder=desc
```

Search — complaints accept `search`, and `/complaints/search` also accepts `q` as an alias:

```http
GET /api/v1/complaints/search?q=road
GET /api/v1/complaints?search=road
```

Complaint search matches against `title`, `description`, `address` and `category.name`, case-insensitively.

---

# 🗑️ Soft Delete

Important records are not permanently deleted immediately. Instead the system sets `deletedAt`:

```json
{
  "deletedAt": "2026-09-09T10:30:00.000Z"
}
```

Normal queries exclude soft-deleted records. `deletedAt` is available on `users`, `citizens`, `technicians`, `departments`, `categories` and `complaints`; `departments` and `categories` also index the column.

---

# ⚡ Performance & Scalability

Implemented optimisations:

- PostgreSQL indexes (including `deletedAt` and foreign keys)
- Prisma `select` / `include` shaping
- Pagination with a hard `limit` cap
- Redis caching with graceful fallback when Redis is down
- Database transactions for status changes and assignment workflows
- Controlled status transitions
- Side-effect notifications deliberately executed outside transactions

---

# 🛡️ Security

- Password hashing with bcrypt (`BCRYPT_SALT_ROUNDS`)
- JWT access + refresh tokens
- Role-based authorization middleware
- Request validation with Zod
- CORS restricted to a single origin (`FRONTEND_URL`) with `credentials: true`
- Blocked-account enforcement on every authenticated request
- Sort-field allowlisting to prevent arbitrary Prisma ordering
- Secure payment verification against the bKash gateway
- Stripe webhook signature (HMAC-SHA256) verification with replay tolerance and event de-duplication
- Input validation before all writes

Deliberately absent today: security response headers and rate limiting. Both `helmet` and `express-rate-limit` are in `package.json`, but neither is imported anywhere in `src/`. See [Rate Limiting](#️-rate-limiting).

---

# ⚙️ Environment Variables

Create a `.env` file:

```env
NODE_ENV=development
PORT=5000

DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"

# Backend origin; read into config.app_url but not referenced by any code path yet
APP_URL="http://localhost:5000"
# The single origin allowed by the CORS middleware
FRONTEND_URL="http://localhost:3000"

BCRYPT_SALT_ROUNDS=10

JWT_ACCESS_SECRET="your_access_secret"
JWT_REFRESH_SECRET="your_refresh_secret"

JWT_ACCESS_EXPIRES_IN="1d"
JWT_REFRESH_EXPIRES_IN="7d"

GOOGLE_CLIENT_ID="your_google_client_id"

# Demo / seed accounts
SUPER_ADMIN_NAME="Super Admin 1"
SUPER_ADMIN_EMAIL="superadmin@gmail.com"
SUPER_ADMIN_PASSWORD="Super@admin12345"

TESTER_ADMIN_NAME="Admin 1"
TESTER_ADMIN_EMAIL="admin@gmail.com"
TESTER_ADMIN_PASSWORD="admin@12345"

TESTER_CITIZEN_NAME="Citizen 1"
TESTER_CITIZEN_EMAIL="citizen@gmail.com"
TESTER_CITIZEN_PASSWORD="citizen@12345"

TESTER_TECHNICIAN_NAME="Technician 1"
TESTER_TECHNICIAN_EMAIL="technician@gmail.com"
TESTER_TECHNICIAN_PASSWORD="technician@12345"

# Redis (optional - used for OTPs & caching, falls back if unavailable)
REDIS_USER="default"
REDIS_PASSWORD="your_redis_password"
REDIS_HOST="your_redis_host"
REDIS_PORT="15540"

# SMTP / Email
SMTP_USER="your_email@gmail.com"
SMTP_PASSWORD="your_app_password"
# Sender address: EMAIL_SENDER takes precedence, SMTP_EMAIL_SENDER is the fallback
EMAIL_SENDER="your_email@gmail.com"
SMTP_EMAIL_SENDER="your_email@gmail.com"

# Cloudinary
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"

# bKash
BKASH_BASE_URL="https://tokenized.sandbox.bka.sh/v1.2.0-beta"
BKASH_USERNAME="your_username"
BKASH_PASSWORD="your_password"
BKASH_APP_KEY="your_app_key"
BKASH_APP_SECRET="your_app_secret"
BKASH_CALLBACK_URL="https://your-domain.com/api/v1/payments/webhook/bkash"

# Stripe
STRIPE_SECRET_KEY="sk_test_xxx"
STRIPE_WEBHOOK_SECRET="whsec_xxx"
STRIPE_CURRENCY="BDT"
STRIPE_SUCCESS_URL="https://your-frontend.com/payments/success"
STRIPE_CANCEL_URL="https://your-frontend.com/payments/cancelled"
STRIPE_WEBHOOK_TOLERANCE="300"
```

Notes:

- The variable name is `APP_URL` — **not** `BACKEND_URL`. It is loaded into `config.app_url` but currently unused, so naming it `BACKEND_URL` has no effect at all.
- The CORS middleware allows exactly one origin: `config.frontend_url` (i.e. `FRONTEND_URL`), with `credentials: true`. Requests from any other origin get no CORS headers, so the browser blocks them.
- The bKash base URL variable is `BKASH_BASE_URL` — **not** `BKASH_SENDBOX_URL`. All five `BKASH_BASE_URL`, `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD` values are required; if any is missing, `POST /api/v1/payments/initiate` and the bKash callback answer `503`.
- `BKASH_CALLBACK_URL` is the default `callbackURL` sent to bKash on `payments/initiate`.
- `STRIPE_SECRET_KEY` is the only value strictly required to enable Stripe. The webhook endpoint additionally needs `STRIPE_WEBHOOK_SECRET`, otherwise every delivery is rejected.
- `GET /api/v1/payments/gateways` shows which of the two gateways is usable in the current environment.
- Never commit `.env` or production secrets to GitHub.

---

# 🚀 Installation & Setup

### 1. Clone the repository

```bash
git clone <your-repository-url>
```

### 2. Go to the project directory

```bash
cd city-complaint-backend
```

### 3. Install dependencies

```bash
npm install
```

or:

```bash
pnpm install
```

### 4. Configure environment variables

Create a `.env` file and add the variables listed above.

### 5. Run database migrations

```bash
npx prisma migrate dev
```

### 6. Generate the Prisma Client

```bash
npx prisma generate
```

The Prisma v7 config lives in `prisma7.config.ts` (schema at `prisma/schema`, migrations at `prisma/migrations`). The generated client is written to `src/generated/prisma`, which is gitignored — so step 6 is **required** before the first `npm run dev` on a fresh clone.

> `prisma/migrations/20260926120000_add_stripe_payment_gateway` adds the nullable Stripe columns (`stripeSessionId`, `stripePaymentIntentId`, `stripeEventId`, `stripeCheckoutUrl`, `stripeCustomerId`) and their unique indexes. Existing bKash payments are untouched, so the migration is safe to run on a live database.

> Seeding is automatic: on server startup `src/app/utils/seed.ts` creates the SUPER_ADMIN, tester ADMIN, tester CITIZEN, tester TECHNICIAN, and the default departments & categories, based on the demo account env vars above.

### 7. Start development server

```bash
npm run dev
```

Server:

```text
http://localhost:5000
```

### npm scripts

| Script                | Purpose                                  |
| --------------------- | ---------------------------------------- |
| `npm run dev`         | Start dev server with watch mode (`tsx`) |
| `npm run build`       | Bundle with `tsup`                       |
| `npm start`           | Run the built server from `dist/`        |
| `npm run lint:check`  | Biome lint (check only)                  |
| `npm run lint:fix`    | Biome lint with autofix                  |
| `npm run format:check`| Biome format check                       |
| `npm run format:fix`  | Biome format with autofix                |

> There is no automated test suite configured (`npm test` is a placeholder).

---

# 🧪 API Testing

Import the Postman collection at `postman/CityComplaint.postman_collection.json` (schema v2.1.0) — **65 requests across 10 folders, covering all 64 endpoints**. The bKash callback is mounted twice (`/payments/webhook/bkash` and its `/payments/webhook` alias) and the collection ships a request for each, which is where the extra request comes from.

| Folder | Requests | Endpoints |
| --- | --- | --- |
| `Server & Health` | 2 | 2 |
| `Authentication` | 10 | 10 |
| `User Profile` | 3 | 3 |
| `Departments` | 7 | 7 |
| `Categories` | 5 | 5 |
| `Complaints` | 15 | 15 |
| `Feedback` | 2 | 2 |
| `Notifications` | 3 | 3 |
| `Payments` | 12 | 11 |
| `Admin` | 6 | 6 |
| **Total** | **65** | **64** |

Run the folders in order: test scripts chain the ids (`departmentId` → `categoryId` → `complaintId` → `paymentId`) so only OTPs and the Stripe signing secret need pasting by hand. The generated collection defines these 21 variables:

| Variable | Purpose |
| --- | --- |
| `baseUrl`, `rootUrl` | Default to `http://localhost:5000/api/v1` and `http://localhost:5000` |
| `accessToken`, `refreshToken` | Populated automatically by the Login / Verify Registration Email (OTP) / Refresh Token test scripts |
| `departmentId` / `newDepartmentId` | Seeded department (safe for reads) vs the throwaway created by `Create Department` (used by update and delete) |
| `categoryId` / `newCategoryId` | Same split, so a soft delete never hits seeded data |
| `complaintId` / `listComplaintId` | Kept separate so listing never clobbers a freshly created complaint |
| `userId`, `technicianId`, `notificationId` | Captured from the matching list endpoints |
| `paymentId` | Payment id used by the Stripe webhook request and by execute / status / refund |
| `bkashPaymentId`, `stripeSessionId`, `stripeEventId` | Gateway references captured by the initiate and webhook scripts |
| `stripeWebhookSecret` | `whsec_...` secret, only needed to sign the Stripe webhook request from Postman |
| `stripeWebhookPayload` | Raw event JSON built by the Stripe webhook pre-request script; the body is sent verbatim so the HMAC matches |
| `otp`, `googleIdToken` | Manual — copy from the inbox and from a Google sign-in |

Every authenticated request sends:

```http
Authorization: Bearer {{accessToken}}
```

The 13 public requests (2 health, 7 auth, 4 payment-gateway) deliberately omit that header.

The collection is generated from source by `scripts/postman-collection.mjs`. After changing a route, regenerate and re-validate it with:

```bash
node scripts/build-postman.mjs
```

The generator fails loudly on a duplicate request, on a request count other than 65, and on anything other than 64 distinct method + path combinations.

### Request bodies

There is no plain-text body anywhere in the collection:

- **JSON endpoints** use `Body → raw → JSON` with an explicit `Content-Type: application/json` header.
- **Endpoints without a payload** (for example `POST /auth/refresh-token`, `POST /complaints/:id/accept`) use `Body → none`.
- **Multipart endpoints** (profile image, complaint create, complaint attachments) use `form-data`, where the JSON travels in a `complaintPayload` text field with content type `application/json`.

### Payment requests

| Request | Route |
| --- | --- |
| `List Configured Gateways` | `GET /payments/gateways` — which gateway is usable right now |
| `Initiate bKash Payment` | `POST /payments/initiate` with `gateway: "bkash"` |
| `Initiate Stripe Payment` | `POST /payments/initiate` with `gateway: "stripe"` |
| `bKash Webhook` | `POST /payments/webhook/bkash?paymentID=…` |
| `bKash Webhook (alias)` | `POST /payments/webhook?paymentID=…` |
| `Stripe Webhook` | `POST /payments/webhook/stripe` |
| `Execute bKash Payment` | `POST /payments/:id/execute` — bKash only, Stripe is rejected with 400 |
| `Query Payment Status` | `GET /payments/:id/status` |
| `My Payments` | `GET /payments/my-payments` |
| `All Payments (Admin)` | `GET /payments/admin/all` |
| `Get Payment` | `GET /payments/:id` |
| `Refund Payment` | `POST /payments/:id/refund` |

The **Stripe Webhook** request carries a pre-request script that builds a `checkout.session.completed` event, stores the exact bytes in `stripeWebhookPayload`, signs `"<timestamp>.<bytes>"` with `stripeWebhookSecret` and upserts the `Stripe-Signature` header. The body is sent as that same variable, so the signature verifies. Leave the secret empty and the request fails with `400`, which is the expected behaviour for an unsigned delivery.

> 19 query parameters ship **disabled** in the collection. The server compares `isActive`, `isRead` and `withManager` strictly against the string `"true"`, and `sla`, `status`, `priority`, `role`, `gateway` against enums — so an empty `?key=` filters the results instead of being ignored. Each request description explains how to enable it.

### Known API issues

Behaviour that looks like a bug but is either deliberate or too ambiguous to change safely. Left as-is on purpose:

| Area | Current behaviour | Why it was not changed |
| --- | --- | --- |
| `GET /api/v1/complaints` as `TECHNICIAN` | The role scope is `assignedTechnicianId = me OR departmentId IS NOT NULL`, so a technician sees every complaint that has a department — not only their assignments. | The OR scope is intentional and is combined with the caller's `search` filter through `AND`. `GET /complaints/:id` and `GET /complaints/my-assigned` do restrict to the assigned technician, so the two endpoints disagree on visibility. |
| `POST /api/v1/auth/google` | The only `POST` body route without `validateRequest`; a missing or malformed `idToken` reaches the service instead of being rejected with 400. | Adding a schema changes the error shape for an existing client contract. |
| `POST /api/v1/complaints/:id/feedback` | The route allows `ADMIN` and `SUPER_ADMIN`, but `feedback.service.ts` throws `403 Only the citizen can submit feedback` for anyone who is not the owning citizen. | Dead permission in the route guard; tightening it changes the status code admins get today. |

> Local webhook development with real Stripe events:
>
> ```bash
> stripe listen --forward-to localhost:5000/api/v1/payments/webhook/stripe
> stripe trigger checkout.session.completed
> ```

---

# 📊 Database Design

The project uses PostgreSQL with Prisma ORM.

```text
User
Citizen
Technician
Department
Category
Complaint
ComplaintAssignment
ComplaintUpdate
ComplaintAttachment
Notification
Feedback
Payment
AuditLog
```

Relationships:

```text
User (CITIZEN) ── Citizen profile
User (TECHNICIAN) ── Technician profile
User ──> Department (staff)  /  Department ──> manager (User)

Category ──> Department
Complaint ──> Category, Citizen, Department, AssignedTechnician
ComplaintAssignment ──> Complaint, Technician
ComplaintUpdate ──> Complaint, User (updatedBy)
ComplaintAttachment ──> Complaint
Feedback ──> Complaint, Citizen
Payment ──> Complaint, User
Notification ──> User, Complaint (optional)
AuditLog ──> User (optional)
```

`Payment` carries both gateways on one table, discriminated by `paymentGateway` (`bkash` / `stripe`):

| Gateway | Reference columns | Status column |
| --- | --- | --- |
| bKash | `bkashPaymentId`, `bkashTrxId` | `status` |
| Stripe | `stripeSessionId`, `stripePaymentIntentId`, `stripeEventId`, `stripeCheckoutUrl`, `stripeCustomerId` | `status` |

Shared columns: `merchantInvoiceNumber` (unique invoice), `amount`, `currency`, `status`, `payerReference`, `paidAt`, `gatewayResponse` (last raw gateway payload), and the refund block (`refundTrxId`, `refundAmount`, `refundReason`, `refundedAt`).

---

# 🔄 Business Logic

Important business operations:

- Category-based department routing
- Role-based complaint access
- Staff assignment with pending-assignment cleanup
- Complaint status transition enforcement
- SLA computation and decoration
- Complaint cancellation and citizen edit rules
- Resolution workflow with `resolvedAt` timestamps
- Citizen feedback after resolution
- bKash and Stripe payment verification (execute, query and signed webhooks)
- Gateway-aware refunds (bKash refund API / Stripe PaymentIntent refund)
- Audit logging (best-effort)
- Soft deletion
- Notification triggers

---

# 📈 Future Improvements

Possible future improvements:

- Real-time notifications using WebSockets
- Advanced GIS/map integration
- AI-based complaint categorization
- Automatic department routing
- Advanced analytics dashboard
- Complaint priority prediction
- Multi-city support
- Mobile application
- Automated test suite

---

# 👨‍💻 Author

**Imran Hossain**

Full Stack Developer

- GitHub: `https://github.com/imranh-dev1`
- LinkedIn: `https://www.linkedin.com/in/imranh-dev1`
- Portfolio: `https://imran-portfolio-iota.vercel.app`
