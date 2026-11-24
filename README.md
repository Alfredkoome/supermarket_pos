records.
- Payment status tracking.

### 10. Backup Management

- Local database backup functionality.
- Backup history management.
- Support for restoring business data.

### system screenshots


The following screenshots demonstrate the major interfaces and functionalities of the Supermarket POS system.

### Dashboard
![dashboard](pos_screenshots/dashboard/dashboard screenshot.jpeg)

### new sale

### calculator transaction calculation
![calculator transaction calculation](pos_screenshots/new sale/calculator transaction calculation.jpeg)

### newsale view
![newsale view](pos_screenshots/new sale/newsale view.jpeg),

### receipt
![receipt](pos_screenshots/new sale/receipt.jpeg)

### products


### add product
![add product](pos_screenshots/products/add product.jpeg)

### products screenshot
![products screenshot](pos_screenshots/products/products screenshot.jpeg)

### sales
![sales](pos_screenshots/sales.jpeg)


### purchases

### purchase dashboard
![purchase dashboard](pos_screenshots/purchases/purchase dashboard.jpeg)

### purchase history
![purchase history](pos_screenshots/purchases/purchase history.jpeg)

### purchase order
![purchase order](pos_screenshots/purchases/purchase order.jpeg)

### purchase reports
![purchase reports](pos_screenshots/purchases/purchase reports.jpeg)

### supplier payment
![supplier payment](pos_screenshots/purchases/supplier payment.jpeg)

### supplier
![supplier](pos_screenshots/purchases/supplier.jpeg)

### settings

### employees management
![employees management](pos_screenshots/settings/employees management.jpeg)

### settings
![settings](pos_screenshots/settings/settings.jpeg)

### terminals management
![terminals management](pos_screenshots/settings/terminals management.jpeg)


### related technologies

### idle timeout
![idle timeout](pos_screenshots/related technologies/idle timeout.jpeg)

### login page
![login page](pos_screenshots/related technologies/login page.jpeg)

### RBAC
![RBAC](pos_screenshots/related technologies/RBAC.jpeg)


## Technology Stack

| Component               | Technology           |
| ----------------------- | -------------------- |
| Frontend                | HTML5                |
| Styling                 | CSS3                 |
| Frontend Logic          | Vanilla JavaScript   |
| Backend                 | Node.js              |
| Backend Framework       | Express.js           |
| Database                | MySQL                |
| Database Driver         | mysql2               |
| Authentication          | Express Session      |
| Password Security       | bcrypt               |
| Payment Integration     | Safaricom Daraja API |
| Development Environment | Visual Studio Code   |

## System Architecture

The application follows a client-server architecture.

```text
       POS FRONTEND
       HTML / CSS / JS
             |
             |
          HTTP API
             |
             |
       NODE.JS BACKEND
          EXPRESS
             |
             |
        MYSQL DATABASE
             |
             |
       BUSINESS DATA
```

Multiple POS terminals can communicate with the backend and access the centralized database through a local network.

## Installation and Setup

### Prerequisites

Install the following:

- Node.js
- MySQL Server
- Git
- Visual Studio Code (recommended)

### 1. Clone the Repository

```bash
git clone https://github.com/Alfredkoome/supermarket_pos
```

### 2. Navigate to the Project

```bash
cd supermarket_pos
```

### 3. Install Backend Dependencies

```bash
cd backend
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the backend directory and configure the required database and payment integration credentials.

Do not upload sensitive credentials to GitHub.

### 5. Configure MySQL

Create the database:

```sql
CREATE DATABASE supermarket_pos;
```

Import the project's database structure and required initial data.

### 6. Start the Backend

```bash
npm start
```

The backend runs on the configured local server port (default: 3000).

### 7. Launch the Frontend

Open the frontend entry HTML file using your configured local development server.

Ensure the frontend API configuration points to the correct backend address.

## Offline Operation

The system is designed primarily for local operation.

Core supermarket operations communicate with the local backend and MySQL database without requiring an external hosting service.

**M-PESA integration requires an internet connection** to communicate with Safaricom's Daraja API.

ngrok is used to expose the locally running backend through a secure public tunnel, enabling external services such as Safaricom Daraja API to communicate with the application.

## Project Goals

The main objectives of this project are:

- Simplify supermarket sales operations.
- Improve inventory management.
- Reduce manual record keeping.
- Improve transaction accuracy.
- Centralize business information.
- Support multiple POS terminals.
- Provide reliable business reporting.
- Improve operational efficiency through automation.

## Project Status

The system has implemented its major operational modules, including sales, inventory, product management, purchasing, supplier management, reporting, user authentication and backup functionality.

Development and testing continue as the system evolves.

## Future Improvements

Potential areas for further development include:

- Enhanced receipt printing.
- Advanced business analytics.
- Additional payment integrations.
- Improved deployment and installation procedures.
- Expanded system monitoring.

## Developer

**Alfred Koome**

Computer Science Student
Kirinyaga University

Developed as a practical software engineering project focused on solving real-world supermarket management challenges.

---

*Supermarket POS — Simplifying Retail Operations Through Technology.*
