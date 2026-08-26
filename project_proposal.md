# Project Proposal Summary: UBR Esports Platform

This document summarizes the **Project Proposal** prepared for the **UBR Esports** Tournament and Gaming Platform.

The official PDF proposal has been generated and saved directly in your project root:
👉 **[Download / View UBR_Esports_Proposal.pdf (Local Link)](file:///c:/Users/MCC%20NUH/OneDrive/Desktop/projects/ubr%20esport/ubr_esports/UBR_Esports_Proposal.pdf)**

---

## 🎯 Executive Summary & Objectives

The **UBR Esports Platform** is engineered to automate tournament registrations, booking slots, and transaction ledgers for competitive esports like BGMI.
- **Automation:** Removes manual verification of team slots and wallets.
- **Financial Integrity:** Integrates secure screenshot validation and UPI/QR payout ledger.
- **Responsive Interface:** Designed for standard mobile browsers and desktop devices.
- **Admin CMS:** Auditable administrator panel to monitor transaction flows and leaderboard statistics.

---

## 🏗️ Proposed System Architecture

Built on a robust, lightweight **Model-View-Controller (MVC)** design pattern:
- **Model Layer:** Strict schemas (using MongoDB & Mongoose) for Users, Wallets, Matches, and Point Tables.
- **View Layer:** Dynamic server-rendered HTML templates utilizing EJS and clean CSS3 styles.
- **Controller Layer:** Express.js routing modules handling Google Authentication, File Uploads (Multer), and Cloudinary asset syncing.

---

## 🛠️ Core Feature Specifications
1. **Google Login:** Secure authentication using Passport.js.
2. **Virtual Wallet Ledger:** Add cash via payment proof images, and withdraw via QR image scanning or UPI.
3. **Tournament Booking Engine:** Live slots listing, entry validation rules, and automatic slots occupancy counter.
4. **Financial Audit Dashboards:** Queue processing interface for admins to review and approve payments.
5. **Leaderboard Management:** Custom points table editor and cover image hosting via Cloudinary.

---

## ⏱️ Timeline & Investment
- **Total Development Cost:** INR 57,000
- **Total Project Duration:** 20 Days
  - *Phase 1 (3 Days):* Authentication and initial schemas.
  - *Phase 2 (5 Days):* Wallet and payment validations.
  - *Phase 3 (4 Days):* Match entries and booking logic.
  - *Phase 4 (5 Days):* Admin dashboards and standings leaderboards.
  - *Phase 5 (3 Days):* Integration testing, Cloudinary setup, and Launch.
- **Support:** 30 Days of complimentary bug-fixing and server config support.
