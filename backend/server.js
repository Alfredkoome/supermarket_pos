console.log("SERVER.JS FROM C:\\song\\kephas\\pos\\backend IS RUNNING");
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const session = require("express-session");
require("dotenv").config();
const backupManager = require("./backup-manager");
const MySQLSessionStore = require("./mysql-session-store");
console.log(
    "M-PESA credentials loaded:",
    !!process.env.MPESA_CONSUMER_KEY &&
    !!process.env.MPESA_CONSUMER_SECRET
);

const app = express();
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters.");
}

const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE === "true";
const configuredSessionMaxAge = Number(process.env.SESSION_MAX_AGE_MS);
const sessionStore = new MySQLSessionStore(db);

app.use(cors({
    origin: [
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://192.168.50.1:5500"
    ],
    credentials: true
}));
app.use(express.json());
app.use(
    session({
        name: "pos.sid",
        secret: sessionSecret,
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            httpOnly: true,
            secure: sessionCookieSecure,
            sameSite: "lax",
            maxAge: Number.isFinite(configuredSessionMaxAge) && configuredSessionMaxAge > 0
                ? configuredSessionMaxAge
                : 12 * 60 * 60 * 1000
        }
    })
);
app.get("/session-test", (req, res) => {
    res.json({
        loggedIn: !!req.session.user,
        user: req.session.user || null
    });
});
function requireLogin(req, res, next) {

    if (!req.session.user) {

        return res.status(401).json({
            error: "You must be logged in"
        });

    }

    next();
}
function requireRole(...allowedRoles) {

    return (req, res, next) => {
console.log("ROLE CHECK");
        console.log("User authentication successful. Checking role...");
        console.log("ALLOWED ROLES:", allowedRoles);

        if (!req.session.user) {
            return res.status(401).json({
                error: "You must be logged in"
            });
        }

        if (!allowedRoles.includes(req.session.user.role)) {
            return res.status(403).json({
                error: "You do not have permission"
            });
        }

        next();
    };
}
db.getConnection((err, connection) => {
    if (err) {
        console.log("Database connection failed:", err);
        return;
    }

    console.log("Connected to MySQL!");
    connection.release();
});

function withCallbackTransaction(res, connectionErrorMessage, handler) {
    (async () => {
        let connection;

        try {
            connection = await new Promise((resolve, reject) => {
                db.getConnection((err, acquiredConnection) => {
                    if (err) return reject(err);
                    resolve(acquiredConnection);
                });
            });

            await new Promise((resolve, reject) => {
                connection.beginTransaction(err => {
                    if (err) return reject(err);
                    resolve();
                });
            });

            await new Promise((resolve, reject) => {
                res.once("finish", resolve);
                try {
                    handler(null, connection);
                } catch (err) {
                    reject(err);
                }
            });
        } catch (err) {
            if (connection) {
                try {
                    await new Promise(resolve => connection.rollback(() => resolve()));
                } catch (rollbackError) {
                    console.error("Transaction rollback error:", rollbackError);
                }
            }

            console.error("Database transaction error:", err);
            if (!res.headersSent) {
                res.status(500).json({ error: connectionErrorMessage });
            }
        } finally {
            if (connection) connection.release();
        }
    })();
}




app.get("/", (req, res) => {
    res.send("pos backend is fine");
});




app.post("/test", (req, res) => {

    console.log(req.body);

    res.json({
        message: "I received your data"
    });

});




// GET PRODUCTS
app.get("/products", (req, res) => {

    console.log("Getting products from database...");

    const sql = `
        SELECT
            products.id,
            products.barcode,
            products.name,
            categories.name AS category,
            products.price,
            products.stock,
            products.min_stock,
            products.is_active
        FROM products
        JOIN categories
            ON products.category_id = categories.id
    `;

    db.query(sql, (err, results) => {

        if (err) {

            console.log(
                "Error getting products:",
                err
            );

            return res.status(500).json({
                error: "Failed to get products"
            });

        }

        res.json(results);

    });

});


// SEARCH PRODUCTS
app.get("/products/search", (req, res) => {
    const search = req.query.q;

    const sql = `
        SELECT
            p.id,
            p.barcode,
            p.name,
            p.price,
            p.stock,
            p.is_active,
            c.name AS category
        FROM products p
        LEFT JOIN categories c
            ON p.category_id = c.id
        WHERE p.name LIKE ?
           OR p.barcode LIKE ?
    `;

    const value = `%${search}%`;

    db.query(
        sql,
        [value, value],
        (err, results) => {

            if (err) {

                console.error(
                    "Product search error:",
                    err
                );

                return res.status(500).json({
                    error:
                        "Database search failed"
                });

            }
console.log("SEARCH DATABASE RESULTS:", results); 
            res.json(results);

        }
    );

});


// ADD PRODUCT
app.post("/products", requireRole("admin","storekeeper"), (req, res) => {
console.log("SESSION:", req.session);
    console.log("USER:", req.session.user);

 if (!req.session.user) {
        return res.status(401).json({
            error: "Not logged in"
        });
    }
    console.log(
        "Received product:",
        req.body
    );

    const {
        barcode,
        name,
        category,
        price,
        stock
    } = req.body;


    // Find category ID
    db.query(
        "SELECT id FROM categories WHERE name = ?",
        [category],
        (err, categoryResult) => {

            if (err) {

                console.log(
                    "Error finding category:",
                    err
                );

                return res.status(500).json({
                    error:
                        "Failed to find category"
                });

            }

            if (categoryResult.length === 0) {

                return res.status(400).json({
                    error:
                        "Category does not exist"
                });

            }

            const category_id =
                categoryResult[0].id;


            // Save product
            const sql = `
                INSERT INTO products
                (
                    barcode,
                    name,
                    category_id,
                    price,
                    stock
                )
                VALUES (?, ?, ?, ?, ?)
            `;

            db.query(
                sql,
                [
                    barcode,
                    name,
                    category_id,
                    price,
                    stock
                ],
                (err, result) => {

                    if (err) {

                        console.log(
                            "Error adding product:",
                            err
                        );

                        return res.status(500).json({
                            error:
                                "Failed to add product"
                        });

                    }

                    res.json({

                        message:
                            "Product added successfully",

                        id:
                            result.insertId,

                        barcode:
                            barcode,

                        name:
                            name,

                        category:
                            category,

                        price:
                            price,

                        stock:
                            stock

                    });

                }
            );

        }
    );

});


// UPDATE PRODUCT
app.put("/products/:id", requireRole("admin","storekeeper"), (req, res) => {

    const productId = req.params.id;

    const {
        barcode,
        name,
        category,
        price,
        stock
    } = req.body;


    // Find category ID
    db.query(
        "SELECT id FROM categories WHERE name = ?",
        [category],
        (err, categoryResult) => {

            if (err) {

                console.log(
                    "Error finding category:",
                    err
                );

                return res.status(500).json({
                    error:
                        "Failed to find category"
                });

            }

            if (categoryResult.length === 0) {

                return res.status(400).json({
                    error:
                        "Category does not exist"
                });

            }

            const category_id =
                categoryResult[0].id;


            // Update product
            const sql = `
                UPDATE products
                SET
                    barcode = ?,
                    name = ?,
                    category_id = ?,
                    price = ?,
                    stock = ?
                WHERE id = ?
            `;

            db.query(
                sql,
                [
                    barcode,
                    name,
                    category_id,
                    price,
                    stock,
                    productId
                ],
                (err, result) => {

                    if (err) {

                        console.log(
                            "Error updating product:",
                            err
                        );

                        return res.status(500).json({
                            error:
                                "Failed to update product"
                        });

                    }

                    if (
                        result.affectedRows === 0
                    ) {

                        return res.status(404).json({
                            error:
                                "Product not found"
                        });

                    }

                    res.json({

                        message:
                            "Product updated successfully",

                        id:
                            productId,

                        barcode:
                            barcode,

                        name:
                            name,

                        category:
                            category,

                        price:
                            price,

                        stock:
                            stock

                    });

                }
            );

        }
    );

});


// DELETE PRODUCT
app.delete("/products/:id", requireRole("admin"), (req, res) => {

    const productId = req.params.id;

    const sql =
    "UPDATE products SET is_active = 0 WHERE id = ?";

    db.query(
        sql,
        [productId],
        (err, result) => {

            if (err) {

                console.log(
                    "Error deactivating product:",
                    err
                );

                return res.status(500).json({
                    error:
                        "Failed to deactivate product"
                });

            }

            if (
                result.affectedRows === 0
            ) {

                return res.status(404).json({
                    error:
                        "Product not found"
                });

            }

            res.json({

                message:
                    "Product deactivated successfully",

                id:
                    productId

            });

        }
    );

});
app.put(
    "/products/:id/reactivate",
    requireRole("admin"),
    (req, res) => {

        const productId = req.params.id;

        const sql =
            "UPDATE products SET is_active = 1 WHERE id = ?";

        db.query(sql, [productId], (err, result) => {

            if (err) {
                console.log(
                    "Error reactivating product:",
                    err
                );

                return res.status(500).json({
                    error: "Failed to reactivate product"
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    error: "Product not found"
                });
            }

            res.json({
                message: "Product reactivated successfully",
                id: productId
            });
        });
    }
);







app.post("/sales", requireRole("admin", "cashier"), (req, res) => {

    const {
        payment_method,
        subtotal,
        discount,
        total,
        items
    } = req.body;
    const user_id = req.session.user.id;
    const terminal_id = req.session.user.terminal_id;


    

    if (
        !user_id ||
        !payment_method ||
        !items ||
        !Array.isArray(items) ||
        items.length === 0 ||
        !terminal_id
    ) {

        return res.status(400).json({

            error:
                "User, payment method, terminal and items are required"

        });

    }


    

    const sale_number =
        "SALE-" + Date.now();


    

    withCallbackTransaction(res, "Could not start transaction", (err, connection) => {

        if (err) {

            console.error(
                "Transaction error:",
                err
            );

            return res.status(500).json({

                error:
                    "Could not start transaction"

            });

        }


        

        const userSql = `
            SELECT
                id,
                name,
                role,
                is_active
            FROM users
            WHERE id = ?
            LIMIT 1
        `;


        connection.query(
            userSql,
            [user_id],
            (err, users) => {

                if (err) {

                    return connection.rollback(() => {

                        console.error(
                            "User check error:",
                            err
                        );

                        res.status(500).json({

                            error:
                                "Failed to check user"

                        });

                    });

                }


                /*
                USER DOES NOT EXIST
                */

                if (
                    users.length === 0
                ) {

                    return connection.rollback(() => {

                        res.status(400).json({

                            error:
                                "Selected user does not exist"

                        });

                    });

                }


                const user =
                    users[0];


                /*
                USER IS INACTIVE
                */

                if (!user.is_active) {

                    return connection.rollback(() => {

                        res.status(400).json({

                            error:
                                "Selected user is inactive"

                        });

                    });

                }


                

                const terminalSql = `
                    SELECT
                        id,
                        terminal_name,
                        location,
                        is_active
                    FROM terminals
                    WHERE id = ?
                    LIMIT 1
                `;


                connection.query(
                    terminalSql,
                    [terminal_id],
                    (err, terminals) => {

                        if (err) {

                            return connection.rollback(() => {

                                console.error(
                                    "Terminal check error:",
                                    err
                                );

                                res.status(500).json({

                                    error:
                                        "Failed to check terminal"

                                });

                            });

                        }


                        /*
                        TERMINAL DOES NOT EXIST
                        */

                        if (
                            terminals.length === 0
                        ) {

                            return connection.rollback(() => {

                                res.status(400).json({

                                    error:
                                        "Selected terminal does not exist"

                                });

                            });

                        }


                        const terminal =
                            terminals[0];


                        /*
                        TERMINAL IS INACTIVE
                        */

                        if (!terminal.is_active) {

                            return connection.rollback(() => {

                                res.status(400).json({

                                    error:
                                        "Selected terminal is inactive"

                                });

                            });

                        }


                        

                        let checked = 0;


                        items.forEach(item => {

                            const stockCheckSql = `
                                SELECT
                                    id,
                                    name,
                                    stock
                                FROM products
                                WHERE id = ?
                            `;


                            connection.query(
                                stockCheckSql,
                                [item.product_id],
                                (err, rows) => {

                                    if (err) {

                                        return connection.rollback(() => {

                                            console.error(
                                                "Stock check error:",
                                                err
                                            );

                                            res.status(500).json({

                                                error:
                                                    "Failed to check product stock"

                                            });

                                        });

                                    }


                                    /*
                                    PRODUCT DOES NOT EXIST
                                    */

                                    if (
                                        rows.length === 0
                                    ) {

                                        return connection.rollback(() => {

                                            res.status(404).json({

                                                error:
                                                    "Product not found",

                                                message:
                                                    `Product ${item.product_name} was not found in the database.`

                                            });

                                        });

                                    }


                                    const product =
                                        rows[0];


                                    

                                    if (
                                        product.stock <
                                        item.quantity
                                    ) {

                                        return connection.rollback(() => {

                                            console.log(

                                                `Not enough stock for ${product.name}. ` +
                                                `Available: ${product.stock}, ` +
                                                `Requested: ${item.quantity}`

                                            );


                                            res.status(400).json({

                                                error:
                                                    "Insufficient stock",

                                                product:
                                                    product.name,

                                                available:
                                                    product.stock,

                                                requested:
                                                    item.quantity,

                                                message:
                                                    `Not enough stock for ${product.name}. ` +
                                                    `Available: ${product.stock}, ` +
                                                    `Requested: ${item.quantity}.`

                                            });

                                        });

                                    }


                                    checked++;


                                    

                                    if (
                                        checked ===
                                        items.length
                                    ) {

                                        saveSale();

                                    }

                                }
                            );

                        });


                        

                        function saveSale() {


                            

                            const saleSql = `
                                INSERT INTO sales
                                (
                                    sale_number,
                                    user_id,
                                    terminal_id,
                                    payment_method,
                                    status,
                                    subtotal,
                                    discount,
                                    total
                                )
                                VALUES
                                (
                                    ?,
                                    ?,
                                    ?,
                                    ?,
                                    'Completed',
                                    ?,
                                    ?,
                                    ?
                                )
                            `;


                            connection.query(
                                saleSql,
                                [
                                    sale_number,
                                    user_id,
                                    terminal_id,
                                    payment_method,
                                    subtotal,
                                    discount,
                                    total
                                ],
                                (err, saleResult) => {

                                    if (err) {

                                        return connection.rollback(() => {

                                            console.error(
                                                "Sale insert error:",
                                                err
                                            );

                                            res.status(500).json({

                                                error:
                                                    "Failed to save sale"

                                            });

                                        });

                                    }


                                    const sale_id =
                                        saleResult.insertId;


                                    

                                    const itemValues = items.map(item => {

    console.log("SALE ITEM:", item);

    console.log(
        "product_id:", item.product_id,
        "product_name:", item.product_name,
        "quantity:", item.quantity,
        "unit_price:", item.unit_price,
        "subtotal:", item.unit_price * item.quantity
    );

    return [
        sale_id,
        item.product_id,
        item.product_name,
        item.quantity,
        item.unit_price,
        item.unit_price * item.quantity
    ];

});

console.log(
    "ITEMS RECEIVED FROM FRONTEND:",
    items
);
                                        console.log(
   
                                            "ITEMS RECEIVED FROM FRONTEND:",
    
                                            items

                                        );


                                    const itemSql = `
                                        INSERT INTO sale_items
                                        (
                                            sale_id,
                                            product_id,
                                            product_name,
                                            quantity,
                                            unit_price,
                                            subtotal
                                        )
                                        VALUES ?
                                    `;


                                    connection.query(
                                        itemSql,
                                        [itemValues],
                                        (err) => {

                                            if (err) {

                                                return connection.rollback(() => {

                                                    console.error(
                                                        "Sale items error:",
                                                        err
                                                    );

                                                    res.status(500).json({

                                                        error:
                                                            "Failed to save sale items",
                                                            mysql_error:
                                                         err.message,

                                                          mysql_code:
           
                                                          err.code


                                                    });

                                                });

                                            }


                                            

                                            let completed = 0;


                                            items.forEach(item => {

                                                const stockSql = `
                                                    UPDATE products
                                                    SET stock = stock - ?
                                                    WHERE id = ?
                                                    AND stock >= ?
                                                `;


                                                connection.query(
                                                    stockSql,
                                                    [
                                                        item.quantity,
                                                        item.product_id,
                                                        item.quantity
                                                    ],
                                                    (err, result) => {

                                                        if (err) {

                                                            return connection.rollback(() => {

                                                                console.error(
                                                                    "Stock update error:",
                                                                    err
                                                                );

                                                                res.status(500).json({

                                                                    error:
                                                                        "Failed to update stock"

                                                                });

                                                            });

                                                        }


                                                        /*
                                                        STOCK BECAME INSUFFICIENT
                                                        */

                                                        if (
                                                            result.affectedRows === 0
                                                        ) {

                                                            return connection.rollback(() => {

                                                                res.status(400).json({

                                                                    error:
                                                                        "Insufficient stock",

                                                                    product:
                                                                        item.product_name,

                                                                    requested:
                                                                        item.quantity,

                                                                    message:
                                                                        `Not enough stock for ${item.product_name}.`

                                                                });

                                                            });

                                                        }


                                                        completed++;


                                                        

                                                        if (
                                                            completed ===
                                                            items.length
                                                        ) {

                                                            connection.commit(
                                                                err => {

                                                                    if (err) {

                                                                        return connection.rollback(
                                                                            () => {

                                                                                console.error(
                                                                                    "Commit error:",
                                                                                    err
                                                                                );

                                                                                res.status(500).json({

                                                                                    error:
                                                                                        "Failed to complete sale"

                                                                                });

                                                                            }
                                                                        );

                                                                    }


                                                                    

                                                                    res.json({

                                                                        message:
                                                                            "Sale completed successfully",

                                                                        sale_id:
                                                                            sale_id,

                                                                        sale_number:
                                                                            sale_number,

                                                                        user_id:
                                                                            user_id,

                                                                        cashier:
                                                                            user.name,

                                                                        terminal_id:
                                                                            terminal.id,

                                                                        terminal:
                                                                            terminal.terminal_name

                                                                    });

                                                                }
                                                            );

                                                        }

                                                    }
                                                );

                                            });

                                        }
                                    );

                                }
                            );

                        }

                    }

                );

            }

        );

    });

});





app.get(
    "/sales",
    requireRole("admin", "cashier"),
    (req, res) => {

        console.log("Fetching sales...");

        const sql = `
            SELECT
                s.id,
                s.created_at AS date,
                s.payment_method AS payment,
                s.status,
                s.subtotal,
                s.discount,
                s.total,

                u.name AS cashier,

                si.id AS item_id,
                si.product_name AS item_name,
                si.quantity AS item_qty,
                si.unit_price AS item_price,
                si.subtotal AS item_subtotal

            FROM sales s

            JOIN users u
                ON s.user_id = u.id

            LEFT JOIN sale_items si
                ON s.id = si.sale_id

            ORDER BY s.created_at DESC, si.id ASC
        `;

        db.query(sql, (err, results) => {

            if (err) {

                console.error(
                    "Error fetching sales:",
                    err
                );

                return res.status(500).json({
                    error: "Failed to fetch sales"
                });

            }


            // Organize database results
            // into individual sales.

            const salesMap = new Map();

            results.forEach(row => {

                if (!salesMap.has(row.id)) {

                    salesMap.set(row.id, {

                        id: row.id,
                        date: row.date,
                        cashier: row.cashier,

                        payment: row.payment,
                        status: row.status,

                        subtotal: Number(row.subtotal),
                        discount: Number(row.discount),
                        total: Number(row.total),

                        items: []

                    });

                }


                // Add sale items
                // to their corresponding sale.

                if (row.item_id !== null) {

                    salesMap.get(row.id).items.push({

                        name: row.item_name,

                        qty: Number(row.item_qty),

                        price: Number(row.item_price),

                        subtotal: Number(row.item_subtotal)

                    });

                }

            });


            // Convert Map into an array
            // because the frontend expects an array.

            const sales = Array.from(
                salesMap.values()
            );


            console.log(
                `Successfully fetched ${sales.length} sales`
            );


            res.status(200).json(sales);

        });

    }
);

app.get("/sales/:id/receipt", requireRole("admin", "cashier"), (req, res) => {

    const saleId = req.params.id;

    const saleSql = `
        SELECT
            s.id,
            s.sale_number,
            s.payment_method,
            s.mpesa_reference,
            s.status,
            s.subtotal,
            s.discount,
            s.total,
            s.created_at,

            u.name AS cashier,

            t.terminal_name,
            t.location AS terminal_location,

            st.store_name,
            st.branch_name,
            st.phone,
            st.email,
            st.address,
            st.kra_pin,
            st.currency,
            st.receipt_footer

        FROM sales s

        JOIN users u
            ON s.user_id = u.id

        LEFT JOIN terminals t
            ON s.terminal_id = t.id

        CROSS JOIN settings st

        WHERE s.id = ?
        AND st.id = 1
    `;

    db.query(
        saleSql,
        [saleId],
        (err, sales) => {

            if (err) {

                console.error(
                    "Error getting receipt:",
                    err
                );

                return res.status(500).json({
                    error: "Failed to get receipt"
                });
            }

            if (sales.length === 0) {

                return res.status(404).json({
                    error: "Sale not found"
                });
            }

            const sale = sales[0];

            const itemSql = `
                SELECT
                    product_id,
                    product_name,
                    quantity,
                    unit_price,
                    subtotal
                FROM sale_items
                WHERE sale_id = ?
                ORDER BY id ASC
            `;

            db.query(
                itemSql,
                [sale.id],
                (itemErr, items) => {

                    if (itemErr) {

                        console.error(
                            "Error getting receipt items:",
                            itemErr
                        );

                        return res.status(500).json({
                            error: "Failed to get receipt items"
                        });
                    }

                    res.json({

                        store: {
                            name: sale.store_name,
                            branch: sale.branch_name,
                            phone: sale.phone,
                            email: sale.email,
                            address: sale.address,
                            kra_pin: sale.kra_pin,
                            currency: sale.currency,
                            footer: sale.receipt_footer
                        },

                        transaction: {
                            id: sale.id,
                            receipt_number: sale.sale_number,
                            date: sale.created_at,
                            cashier: sale.cashier,
                            terminal: sale.terminal_name,
                            terminal_location: sale.terminal_location,
                            status: sale.status
                        },

                        items: items,

                        totals: {
                            subtotal: sale.subtotal,
                            discount: sale.discount,
                            total: sale.total
                        },

                        payment: {
                            method: sale.payment_method,
                            mpesa_reference: sale.mpesa_reference
                        }

                    });
                }
            );
        }
    );
});




app.get("/stock",requireRole("admin","storekeeper"), (req, res) => {

    const sql = `
        SELECT
            p.id,
            p.barcode,
            p.name,
            c.name AS category,
            p.stock,
            p.min_stock
        FROM products p
        JOIN categories c
            ON p.category_id = c.id
        WHERE p.is_active = 1
        ORDER BY p.name ASC
    `;


    db.query(
        sql,
        (err, results) => {

            if (err) {

                console.error(
                    "Error getting stock:",
                    err
                );

                return res.status(500).json({

                    error:
                        "Failed to get stock"

                });

            }

            res.json(results);

        }
    );

});





app.post(
    "/stock/add",
    requireRole("admin","storekeeper"),
    (req, res) => {
    const {
        barcode,
        quantity
    } = req.body;


    if (
        !barcode ||
        !quantity ||
        quantity <= 0
    ) {

        return res.status(400).json({

            error:
                "Invalid barcode or quantity"

        });

    }


    const sql = `
        UPDATE products
        SET stock = stock + ?
        WHERE barcode = ?
    `;


    db.query(
        sql,
        [
            quantity,
            barcode
        ],
        (err, result) => {

            if (err) {

                console.error(
                    "Error adding stock:",
                    err
                );

                return res.status(500).json({

                    error:
                        "failed to add stock"

                });

            }


            if (
                result.affectedRows === 0
            ) {

                return res.status(404).json({

                    error:
                        "Product not found"

                });

            }


            const getProduct = `
                SELECT
                    id,
                    barcode,
                    name,
                    stock,
                    min_stock
                FROM products
                WHERE barcode = ?
            `;


            db.query(
                getProduct,
                [barcode],
                (getErr, products) => {

                    if (getErr) {

                        console.error(
                            "Error getting updated stock:",
                            getErr
                        );

                        return res.status(500).json({

                            error:
                                "Stock updated but failed to retrieve product"

                        });

                    }


                    res.json({

                        message:
                            "Stock added successfully",

                        product:
                            products[0]

                    });

                }
            );

        }
    );

});




app.get("/dashboard", requireLogin, async (req, res) => {

    console.log(
        "Loading dashboard data from database..."
    );


    // Helper function
    const query = (
        sql,
        values = []
    ) => {

        return new Promise(
            (resolve, reject) => {

                db.query(
                    sql,
                    values,
                    (err, results) => {

                        if (err) {

                            reject(err);

                        } else {

                            resolve(results);

                        }

                    }
                );

            }
        );

    };


    try {


        

        const todaySalesResult =
            await query(`

                SELECT
                    COALESCE(
                        SUM(total),
                        0
                    ) AS todaySales

                FROM sales

                WHERE DATE(created_at) =
                    CURDATE()

                AND LOWER(status) =
                    'completed'

            `);


        

        const todayTransactionsResult =
            await query(`

                SELECT
                    COUNT(*) AS todayTransactions

                FROM sales

                WHERE DATE(created_at) =
                    CURDATE()

            `);


        

        const todayCompletedResult =
            await query(`

                SELECT
                    COUNT(*) AS
                        todayCompletedTransactions

                FROM sales

                WHERE DATE(created_at) =
                    CURDATE()

                AND LOWER(status) =
                    'completed'

            `);


        

        const lowStockCountResult =
            await query(`

                SELECT
                    COUNT(*) AS lowStockCount

                FROM products

                WHERE is_active = 1

                AND stock > 0

                AND stock <= min_stock

            `);


        

        const outOfStockCountResult =
            await query(`

                SELECT
                    COUNT(*) AS outOfStockCount

                FROM products

                WHERE is_active = 1

                AND stock <= 0

            `);


        

        const lowStockResult =
            await query(`

                SELECT
                    p.id,
                    p.name,
                    p.stock,
                    p.min_stock,
                    c.name AS category

                FROM products p

                LEFT JOIN categories c
                    ON p.category_id = c.id

                WHERE p.is_active = 1

                AND p.stock > 0

                AND p.stock <= p.min_stock

                ORDER BY
                    p.stock ASC,
                    p.name ASC

            `);


        

        const salesOverviewResult =
            await query(`

                SELECT

                    DATE_FORMAT(
                        created_at,
                        '%Y-%m-%d'
                    ) AS sale_date,

                    COALESCE(
                        SUM(total),
                        0
                    ) AS amount

                FROM sales

                WHERE created_at >=
                    DATE_SUB(
                        CURDATE(),
                        INTERVAL 6 DAY
                    )

                AND created_at <
                    DATE_ADD(
                        CURDATE(),
                        INTERVAL 1 DAY
                    )

                AND LOWER(status) =
                    'completed'

                GROUP BY
                    DATE_FORMAT(
                        created_at,
                        '%Y-%m-%d'
                    )

                ORDER BY sale_date ASC

            `);


        

        const salesOverview = [];


        for (
            let i = 6;
            i >= 0;
            i--
        ) {

            const dateResult =
                await query(`

                    SELECT

                        DATE_FORMAT(
                            DATE_SUB(
                                CURDATE(),
                                INTERVAL ? DAY
                            ),
                            '%Y-%m-%d'
                        ) AS sale_date,

                        DATE_FORMAT(
                            DATE_SUB(
                                CURDATE(),
                                INTERVAL ? DAY
                            ),
                            '%a'
                        ) AS day

                `, [i, i]);


            const date =
                dateResult[0].sale_date;

            const day =
                dateResult[0].day;


            const existingSale =
                salesOverviewResult.find(
                    sale =>
                        String(
                            sale.sale_date
                        ).slice(0, 10) === date
                );


            salesOverview.push({

                date:
                    date,

                day:
                    day,

                amount:
                    existingSale
                        ? Number(
                            existingSale.amount
                        )
                        : 0

            });

        }


        

        const recentTransactions =
            await query(`

                SELECT

                    s.id,
                    s.sale_number,
                    s.payment_method,
                    s.status,
                    s.total,
                    s.created_at,

                    s.user_id,
                    u.name AS cashier,

                    s.terminal_id,
                    t.terminal_name,
                    t.location AS terminal_location

                FROM sales s

                LEFT JOIN users u
                    ON s.user_id = u.id

                LEFT JOIN terminals t
                    ON s.terminal_id = t.id

                ORDER BY
                    s.created_at DESC

                LIMIT 10

            `);


        

        const topProducts =
            await query(`

                SELECT

                    si.product_id,

                    si.product_name AS name,

                    SUM(si.quantity) AS sold

                FROM sale_items si

                JOIN sales s
                    ON si.sale_id = s.id

                WHERE LOWER(s.status) =
                    'completed'

                GROUP BY
                    si.product_id,
                    si.product_name

                ORDER BY
                    sold DESC

                LIMIT 5

            `);


        

// TEST INSERT
        
        const totalPurchasesResult = await query(
            String.raw`SELECT COUNT(*) AS totalPurchases FROM purchases`
        );
        const purchasesTodayResult = await query(
            String.raw`SELECT COUNT(*) AS purchasesToday FROM purchases WHERE DATE(created_at) = CURDATE()`
        );

        const pendingOrdersResult = await query(
            String.raw`SELECT COUNT(*) AS pendingOrders FROM purchases WHERE LOWER(status) = 'pending approval'`
        );

        const partiallyReceivedResult = await query(
            String.raw`SELECT COUNT(*) AS partiallyReceived FROM purchases WHERE LOWER(status) = 'partially received'`
        );


        const outstandingPaymentsResult = await query(
            String.raw`SELECT COALESCE(SUM(p.total_amount - COALESCE(sp.total_paid, 0)), 0) AS outstandingPayments FROM purchases p LEFT JOIN (SELECT purchase_id, SUM(amount) AS total_paid FROM supplier_payments GROUP BY purchase_id) sp ON p.id = sp.purchase_id WHERE p.total_amount > COALESCE(sp.total_paid, 0)`
        );

        const statusCountsResult = await query(
            String.raw`SELECT LOWER(status) AS status, COUNT(*) AS count FROM purchases GROUP BY LOWER(status)`
        );
        res.json({
            todaySales:
                Number(
                    todaySalesResult[0]
                        .todaySales
                ),


            todayTransactions:
                Number(
                    todayTransactionsResult[0]
                        .todayTransactions
                ),


            todayCompletedTransactions:
                Number(
                    todayCompletedResult[0]
                        .todayCompletedTransactions
                ),


            lowStockCount:
                Number(
                    lowStockCountResult[0]
                        .lowStockCount
                ),


            outOfStockCount:
                Number(
                    outOfStockCountResult[0]
                        .outOfStockCount
                ),


            totalPurchases:
                Number(
                    totalPurchasesResult[0]
                        .totalPurchases
                ),

            purchasesToday:
                Number(
                    purchasesTodayResult[0]
                        .purchasesToday
                ),

            pendingOrders:
                Number(
                    pendingOrdersResult[0]
                        .pendingOrders
                ),

            partiallyReceived:
                Number(
                    partiallyReceivedResult[0]
                        .partiallyReceived
                ),

            outstandingPayments:
                Number(
                    outstandingPaymentsResult[0]
                        .outstandingPayments
                ),

            statusCounts: Object.fromEntries(
                statusCountsResult.map(
                    row => [row.status, Number(row.count)]
                )
            ),

            lowStock:

                lowStockResult.map(
                    product => ({

                        id:
                            product.id,

                        name:
                            product.name,

                        stock:
                            Number(
                                product.stock
                            ),

                        min_stock:
                            Number(
                                product.min_stock
                            ),

                        category:
                            product.category

                    })
                ),


            salesOverview,


            recentTransactions:

                recentTransactions.map(
                    transaction => ({

                        id:
                            transaction.id,

                        sale_number:
                            transaction.sale_number,

                        payment_method:
                            transaction.payment_method,

                        status:
                            transaction.status,

                        total:
                            Number(
                                transaction.total
                            ),

                        created_at:
                            transaction.created_at,

                        user_id:
                            transaction.user_id,

                        cashier:
                            transaction.cashier ||
                            "Unknown",

                        terminal_id:
                            transaction.terminal_id,

                        terminal:
                            transaction.terminal_name ||
                            "Unknown",

                        terminal_location:
                            transaction.terminal_location ||
                            null

                    })
                ),


            topProducts:

                topProducts.map(
                    product => ({

                        product_id:
                            product.product_id,

                        name:
                            product.name,

                        sold:
                            Number(
                                product.sold
                            )

                    })
                )

        });

    } catch (error) {

        console.error(
            "Dashboard database error:",
            error
        );

        res.status(500).json({

            error:
                "Failed to load dashboard data"

        });

    }

});




app.get("/reports",requireRole("admin"), (req, res) => {

console.log("🔥 NEW REPORTS ROUTE IS RUNNING");

    const range = req.query.range || "week";

    let dateCondition = "";

    if (range === "today") {
        dateCondition = `
            s.created_at >= CURDATE()
            AND s.created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        `;
    }
    else if (range === "yesterday") {
        dateCondition = `
            s.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
            AND s.created_at < CURDATE()
        `;
    }
    else if (range === "week") {
        dateCondition = `
            s.created_at >= DATE_SUB(
                CURDATE(),
                INTERVAL WEEKDAY(CURDATE()) DAY
            )
            AND s.created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        `;
    }
    else if (range === "month") {
        dateCondition = `
            s.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
            AND s.created_at < DATE_ADD(
                LAST_DAY(CURDATE()),
                INTERVAL 1 DAY
            )
        `;
    }
    else {
        return res.status(400).json({
            error: "Invalid report range"
        });
    }


    // --------------------------------------------------
    // HELPER FOR MYSQL QUERIES
    // --------------------------------------------------

    const query = (sql) => new Promise((resolve, reject) => {

        db.query(sql, (err, results) => {

            if (err) {
                reject(err);
            }
            else {
                resolve(results);
            }

        });

    });


    // --------------------------------------------------
    // SUMMARY
    // --------------------------------------------------

    const summarySQL = `
        SELECT

            COALESCE(SUM(s.total), 0) AS totalSales,

            COUNT(*) AS transactions,

            COALESCE(AVG(s.total), 0) AS averageSale,

            COALESCE(SUM(s.discount), 0) AS discounts,

            COALESCE(
                SUM(s.total + s.discount),
                0
            ) AS grossSales

        FROM sales s

        WHERE LOWER(s.status) = 'completed'

        AND ${dateCondition}
    `;


    // --------------------------------------------------
    // PERFORMANCE
    // --------------------------------------------------

    let performanceSQL = "";


    // ==========================
    // TODAY
    // ==========================

    if (range === "today") {

        performanceSQL = `

            SELECT

                DATE_FORMAT(
                    CURDATE(),
                    '%Y-%m-%d'
                ) AS date,

                COUNT(s.id) AS transactions,

                COALESCE(
                    SUM(s.total + s.discount),
                    0
                ) AS grossSales,

                COALESCE(
                    SUM(s.discount),
                    0
                ) AS discounts,

                COALESCE(
                    SUM(s.total),
                    0
                ) AS netSales,

                COALESCE(
                    AVG(s.total),
                    0
                ) AS averageSale

            FROM sales s

            WHERE LOWER(s.status) = 'completed'

            AND s.created_at >= CURDATE()

            AND s.created_at <
                DATE_ADD(
                    CURDATE(),
                    INTERVAL 1 DAY
                )
        `;
    }


    // ==========================
    // YESTERDAY
    // ==========================

    else if (range === "yesterday") {

        performanceSQL = `

            SELECT

                DATE_FORMAT(
                    DATE_SUB(
                        CURDATE(),
                        INTERVAL 1 DAY
                    ),
                    '%Y-%m-%d'
                ) AS date,

                COUNT(s.id) AS transactions,

                COALESCE(
                    SUM(s.total + s.discount),
                    0
                ) AS grossSales,

                COALESCE(
                    SUM(s.discount),
                    0
                ) AS discounts,

                COALESCE(
                    SUM(s.total),
                    0
                ) AS netSales,

                COALESCE(
                    AVG(s.total),
                    0
                ) AS averageSale

            FROM sales s

            WHERE LOWER(s.status) = 'completed'

            AND s.created_at >=
                DATE_SUB(
                    CURDATE(),
                    INTERVAL 1 DAY
                )

            AND s.created_at < CURDATE()
        `;
    }


    // ==========================
    // WEEK
    // ==========================

    else if (range === "week") {

        performanceSQL = `

            SELECT

                DATE_FORMAT(
                    dates.date,
                    '%Y-%m-%d'
                ) AS date,

                COUNT(s.id) AS transactions,

                COALESCE(
                    SUM(s.total + s.discount),
                    0
                ) AS grossSales,

                COALESCE(
                    SUM(s.discount),
                    0
                ) AS discounts,

                COALESCE(
                    SUM(s.total),
                    0
                ) AS netSales,

                COALESCE(
                    AVG(s.total),
                    0
                ) AS averageSale

            FROM (

                SELECT

                    DATE_ADD(

                        DATE_SUB(
                            CURDATE(),
                            INTERVAL WEEKDAY(CURDATE()) DAY
                        ),

                        INTERVAL numbers.n DAY

                    ) AS date

                FROM (

                    SELECT 0 AS n

                    UNION ALL SELECT 1

                    UNION ALL SELECT 2

                    UNION ALL SELECT 3

                    UNION ALL SELECT 4

                    UNION ALL SELECT 5

                    UNION ALL SELECT 6

                ) numbers

            ) dates

            LEFT JOIN sales s

                ON DATE(s.created_at) = dates.date

                AND LOWER(s.status) = 'completed'

            GROUP BY dates.date

            ORDER BY dates.date
        `;
    }


    // ==========================
    // MONTH
    // ==========================

    else if (range === "month") {

        performanceSQL = `

            SELECT

                DATE_FORMAT(
                    dates.date,
                    '%Y-%m-%d'
                ) AS date,

                COUNT(s.id) AS transactions,

                COALESCE(
                    SUM(s.total + s.discount),
                    0
                ) AS grossSales,

                COALESCE(
                    SUM(s.discount),
                    0
                ) AS discounts,

                COALESCE(
                    SUM(s.total),
                    0
                ) AS netSales,

                COALESCE(
                    AVG(s.total),
                    0
                ) AS averageSale

            FROM (

                SELECT

                    DATE_ADD(

                        DATE_FORMAT(
                            CURDATE(),
                            '%Y-%m-01'
                        ),

                        INTERVAL numbers.n DAY

                    ) AS date

                FROM (

                    SELECT 0 AS n

                    UNION ALL SELECT 1

                    UNION ALL SELECT 2

                    UNION ALL SELECT 3

                    UNION ALL SELECT 4

                    UNION ALL SELECT 5

                    UNION ALL SELECT 6

                    UNION ALL SELECT 7

                    UNION ALL SELECT 8

                    UNION ALL SELECT 9

                    UNION ALL SELECT 10

                    UNION ALL SELECT 11

                    UNION ALL SELECT 12

                    UNION ALL SELECT 13

                    UNION ALL SELECT 14

                    UNION ALL SELECT 15

                    UNION ALL SELECT 16

                    UNION ALL SELECT 17

                    UNION ALL SELECT 18

                    UNION ALL SELECT 19

                    UNION ALL SELECT 20

                    UNION ALL SELECT 21

                    UNION ALL SELECT 22

                    UNION ALL SELECT 23

                    UNION ALL SELECT 24

                    UNION ALL SELECT 25

                    UNION ALL SELECT 26

                    UNION ALL SELECT 27

                    UNION ALL SELECT 28

                    UNION ALL SELECT 29

                    UNION ALL SELECT 30

                ) numbers

                WHERE DATE_ADD(

                    DATE_FORMAT(
                        CURDATE(),
                        '%Y-%m-01'
                    ),

                    INTERVAL numbers.n DAY

                ) <= LAST_DAY(CURDATE())

            ) dates

            LEFT JOIN sales s

                ON DATE(s.created_at) = dates.date

                AND LOWER(s.status) = 'completed'

            GROUP BY dates.date

            ORDER BY dates.date
        `;
    }


    // --------------------------------------------------
    // TOP PRODUCTS
    // --------------------------------------------------

    const topProductsSQL = `

        SELECT

            si.product_id,

            si.product_name AS name,

            COALESCE(
                c.name,
                'Unknown'
            ) AS category,

            SUM(si.quantity) AS qty,

            COALESCE(
                SUM(si.subtotal),
                0
            ) AS revenue

        FROM sale_items si

        JOIN sales s
            ON si.sale_id = s.id

        LEFT JOIN products p
            ON si.product_id = p.id

        LEFT JOIN categories c
            ON p.category_id = c.id

        WHERE LOWER(s.status) = 'completed'

        AND ${dateCondition}

        GROUP BY
            si.product_id,
            si.product_name,
            c.name

        ORDER BY qty DESC

        LIMIT 5
    `;


    // --------------------------------------------------
    // PAYMENT METHODS
    // --------------------------------------------------

    const paymentMethodsSQL = `

        SELECT

            s.payment_method AS method,

            COUNT(*) AS transactions,

            COALESCE(
                SUM(s.total),
                0
            ) AS amount

        FROM sales s

        WHERE LOWER(s.status) = 'completed'

        AND ${dateCondition}

        GROUP BY s.payment_method
    `;


    // --------------------------------------------------
    // INVENTORY
    // --------------------------------------------------

    const inventorySQL = `

        SELECT

            COUNT(*) AS totalProducts,

            COALESCE(
                SUM(stock > min_stock),
                0
            ) AS inStock,

            COALESCE(
                SUM(
                    stock > 0
                    AND stock <= min_stock
                ),
                0
            ) AS lowStock,

            COALESCE(
                SUM(stock <= 0),
                0
            ) AS outOfStock

        FROM products

        WHERE is_active = 1
    `;


    // --------------------------------------------------
    // RUN ALL QUERIES
    // --------------------------------------------------

    Promise.all([

        query(summarySQL),

        query(performanceSQL),

        query(topProductsSQL),

        query(paymentMethodsSQL),

        query(inventorySQL)

    ])

    .then(([
        summary,
        performance,
        topProducts,
        paymentMethods,
        inventory
    ]) => {

        res.json({

            range: range,

            summary: summary[0],

            performance: performance,

            topProducts: topProducts,

            paymentMethods: paymentMethods,

            inventory: inventory[0]

        });

    })

    .catch(err => {

        console.error(
            "Reports error:",
            err
        );

        res.status(500).json({

            error: "Failed to load reports",

            details: err.message

        });

    });

});


// Automatic database backups are generated only by this central backend.
app.get("/backups/history", requireRole("admin"), async (req, res) => {
    try {
        const history = await backupManager.getHistory();
        return res.json({
            scheduleTime: backupManager.parseScheduleTime().text,
            scheduleTimezone: backupManager.getScheduleTimezone(),
            retentionCount: 30,
            history: history.slice(-100).reverse()
        });
    } catch (err) {
        console.error("Failed to load backup history:", err);
        return res.status(500).json({ error: "Failed to load backup history." });
    }
});

app.post("/backups/run", requireRole("admin"), async (req, res) => {
    try {
        const entry = await backupManager.runBackup({
            reason: "manual",
            initiatedBy: req.session.user.id || req.session.user.username || null
        });
        if (entry.status === "Success") return res.status(200).json({ success: true, backup: entry });
        if (entry.status === "Skipped") return res.status(409).json({ success: false, error: entry.errorMessage });
        return res.status(500).json({ success: false, error: entry.errorMessage || "Database backup failed." });
    } catch (err) {
        console.error("Database backup request failed:", err);
        return res.status(500).json({ success: false, error: "Database backup failed." });
    }
});

// GET SETTINGS
app.get("/settings", requireRole("admin"), (req, res) => {

    const sql = `

        SELECT

            id,
            store_name,
            branch_name,
            phone,
            email,
            address,
            kra_pin,
            terminal_name,
            currency,
            receipt_prefix,
            quick_sale_enabled,
            show_store_name,
            show_cashier_name,
            show_transaction_id,
            show_datetime,
            show_payment_method,
            receipt_footer,
            theme,
            notifications_enabled,
            low_stock_alerts_enabled,
            pos_sounds_enabled,
            auto_logout_enabled,
            session_timeout,
            updated_at

        FROM settings

        WHERE id = 1

        LIMIT 1

    `;


    db.query(
        sql,
        (err, results) => {

            if (err) {

                console.error(
                    "Error loading settings:",
                    err
                );

                return res.status(500).json({

                    error:
                        "Failed to load settings"

                });

            }


            if (
                results.length === 0
            ) {

                return res.status(404).json({

                    error:
                        "Settings not found"

                });

            }


            res.json(
                results[0]
            );

        }
    );

});


// UPDATE SETTINGS
app.put("/settings", requireRole("admin"), (req, res) => {

    const {

        store_name,
        branch_name,
        phone,
        email,
        address,
        kra_pin,
        terminal_name,
        currency,
        receipt_prefix,
        quick_sale_enabled,
        show_store_name,
        show_cashier_name,
        show_transaction_id,
        show_datetime,
        show_payment_method,
        receipt_footer,
        theme,
        notifications_enabled,
        low_stock_alerts_enabled,
        pos_sounds_enabled,
        auto_logout_enabled,
        session_timeout

    } = req.body;


    const sql = `

        UPDATE settings

        SET

            store_name = ?,
            branch_name = ?,
            phone = ?,
            email = ?,
            address = ?,
            kra_pin = ?,
            terminal_name = ?,
            currency = ?,
            receipt_prefix = ?,
            quick_sale_enabled = ?,
            show_store_name = ?,
            show_cashier_name = ?,
            show_transaction_id = ?,
            show_datetime = ?,
            show_payment_method = ?,
            receipt_footer = ?,
            theme = ?,
            notifications_enabled = ?,
            low_stock_alerts_enabled = ?,
            pos_sounds_enabled = ?,
            auto_logout_enabled = ?,
            session_timeout = ?

        WHERE id = 1

    `;


    const values = [

        store_name,
        branch_name,
        phone,
        email,
        address,
        kra_pin,
        terminal_name,
        currency,
        receipt_prefix,
        quick_sale_enabled,
        show_store_name,
        show_cashier_name,
        show_transaction_id,
        show_datetime,
        show_payment_method,
        receipt_footer,
        theme,
        notifications_enabled,
        low_stock_alerts_enabled,
        pos_sounds_enabled,
        auto_logout_enabled,
        session_timeout

    ];


    db.query(
        sql,
        values,
        (err, result) => {

            if (err) {

                console.error(
                    "Error updating settings:",
                    err
                );

                return res.status(500).json({

                    error:
                        "Failed to update settings"

                });

            }


            res.json({

                message:
                    "Settings updated successfully"

            });

        }
    );

});



// GET ALL TERMINALS
app.get("/terminals", (req, res) => {
    const sql = `
        SELECT
            id,
            terminal_name,
            location,
            is_active
        FROM terminals
        ORDER BY id
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error loading terminals:", err);
            return res.status(500).json({
                error: "Failed to load terminals"
            });
        }

        console.log("TERMINALS:", results);
        res.json(results);
    });
});

// ACTIVATE / DEACTIVATE TERMINAL
app.patch("/terminals/:id/status", requireRole("admin"), (req, res) => {

    const terminalId = req.params.id;
    const { is_active } = req.body;

    if (is_active !== 0 && is_active !== 1) {

        return res.status(400).json({
            error: "is_active must be 0 or 1"
        });

    }

    const sql = `
        UPDATE terminals
        SET is_active = ?
        WHERE id = ?
    `;

    db.query(
        sql,
        [is_active, terminalId],
        (err, result) => {

            if (err) {

                console.error(
                    "Error updating terminal status:",
                    err
                );

                return res.status(500).json({
                    error:
                        "Failed to update terminal status"
                });

            }

            if (result.affectedRows === 0) {

                return res.status(404).json({
                    error:
                        "Terminal not found"
                });

            }

            res.json({
                message:
                    is_active === 1
                        ? "Terminal activated successfully"
                        : "Terminal deactivated successfully"
            });

        }
    );

});
// ACTIVATE / DEACTIVATE USER
app.patch("/users/:id/status", requireRole("admin"), (req, res) => {
    const userId = req.params.id;
    const { is_active } = req.body;

    if (is_active !== 0 && is_active !== 1) {
        return res.status(400).json({
            error: "is_active must be 0 or 1"
        });
    }

    const sql = `
        UPDATE users
        SET is_active = ?
        WHERE id = ?
    `;

    db.query(sql, [is_active, userId], (err, result) => {
        if (err) {
            console.error("Error updating user status:", err);

            return res.status(500).json({
                error: "Failed to update user status"
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "User not found"
            });
        }

        res.json({
            message:
                is_active === 1
                    ? "User activated successfully"
                    : "User deactivated successfully"
        });
    });
});


app.post("/login", (req, res) => {

    const {
        email,
        password,
        terminal_id
    } = req.body;


    

    if (
        !email ||
        !password ||
        !terminal_id
    ) {

        return res.status(400).json({

            error:
                "Email, password and terminal are required"

        });

    }


    

    const userSql = `

        SELECT

            id,
            name,
            email,
            password_hash,
            role,
            is_active

        FROM users

        WHERE email = ?

        LIMIT 1

    `;


    db.query(
        userSql,
        [email],
        async (err, users) => {

            if (err) {

                console.error(
                    "Login user error:",
                    err
                );

                return res.status(500).json({

                    error:
                        "Server error during login"

                });

            }


            /*
            USER DOES NOT EXIST
            */

            if (
                users.length === 0
            ) {

                return res.status(401).json({

                    error:
                        "Invalid email or password"

                });

            }


            const user =
                users[0];


            /*
            USER INACTIVE
            */

            if (
                !user.is_active
            ) {

                return res.status(403).json({

                    error:
                        "This account is inactive"

                });

            }


            

            const terminalSql = `

                SELECT

                    id,
                    terminal_name,
                    location,
                    is_active

                FROM terminals

                WHERE id = ?

                LIMIT 1

            `;


            db.query(
                terminalSql,
                [terminal_id],
                async (
                    err,
                    terminals
                ) => {

                    if (err) {

                        console.error(
                            "Login terminal error:",
                            err
                        );

                        return res.status(500).json({

                            error:
                                "Server error while checking terminal"

                        });

                    }
                    


                    /*
                    TERMINAL DOES NOT EXIST
                    */

                    if (
                        terminals.length === 0
                    ) {

                        return res.status(400).json({

                            error:
                                "Selected terminal does not exist"

                        });

                    }


                    const terminal =
                        terminals[0];


                    /*
                    TERMINAL INACTIVE
                    */

                    if (
                        !terminal.is_active
                    ) {

                        return res.status(400).json({

                            error:
                                "Selected terminal is inactive"

                        });

                    }


                    

                    const passwordMatch =
                        await bcrypt.compare(

                            password,

                            user.password_hash

                        );


                    if (
                        !passwordMatch
                    ) {

                        return res.status(401).json({

                            error:
                                "Invalid email or password"

                        });

                    }


                    
                    req.session.regenerate(sessionError => {
                        if (sessionError) {
                            console.error("Session regeneration error:", sessionError);
                            return res.status(500).json({
                                error: "Could not create login session"
                            });
                        }

                        req.session.user = {
                            id: user.id,
                            name: user.name,
                            email: user.email,
                            role: user.role,
                            terminal_id: terminal.id
                        };

                        res.json({

                        message:
                            "Login successful",


                        id:
                            user.id,

                        name:
                            user.name,

                        email:
                            user.email,

                        role:
                            user.role,


                        /*
                        CURRENT TERMINAL
                        */

                        terminal:
                            terminal.terminal_name,

                        terminal_id:
                            terminal.id,

                        terminal_location:
                            terminal.location

                        });
                    });

                }
            );

        }
    );

});

app.post("/logout", requireLogin, (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Session logout error:", err);
            return res.status(500).json({ error: "Could not log out" });
        }

        res.clearCookie("connect.sid", { path: "/" });
        return res.json({ success: true, message: "Logged out successfully" });
    });
});

//payment methods permite
app.get("/payment-methods", (req, res) => {

    const sql = `
        SELECT
            id,
            name,
            description,
            is_enabled
        FROM payment_methods
        ORDER BY id
    `;

    db.query(sql, (err, results) => {

        if (err) {

            console.error(
                "Error loading payment methods:",
                err
            );

            return res.status(500).json({
                error: "Failed to load payment methods"
            });
        }

        res.json(results);

    });

});
// ACTIVATE / DEACTIVATE PAYMENT METHOD
app.patch("/payment-methods/:id/status", requireRole("admin"), (req, res) => {

    const paymentMethodId = req.params.id;
    const { is_enabled } = req.body;

    if (is_enabled !== 0 && is_enabled !== 1) {

        return res.status(400).json({
            error: "is_enabled must be 0 or 1"
        });

    }

    const sql = `
        UPDATE payment_methods
        SET is_enabled = ?
        WHERE id = ?
    `;

    db.query(
        sql,
        [is_enabled, paymentMethodId],
        (err, result) => {

            if (err) {

                console.error(
                    "Error updating payment method status:",
                    err
                );

                return res.status(500).json({
                    error:
                        "Failed to update payment method status"
                });

            }

            if (result.affectedRows === 0) {

                return res.status(404).json({
                    error:
                        "Payment method not found"
                });

            }

            res.json({

                message:
                    is_enabled === 1
                        ? "Payment method enabled successfully"
                        : "Payment method disabled successfully"

            });

        }
    );

});
app.put("/change-password", requireLogin, async (req, res) => {
    console.log("CHANGE PASSWORD ROUTE HIT");

    const { current_password, new_password } = req.body;
    const user_id = req.session.user.id;


    

    if (
        !user_id ||
        !current_password ||
        !new_password
    ) {

        return res.status(400).json({

            error:
                "User ID, current password and new password are required"

        });

    }


    

    if (new_password.length < 6) {

        return res.status(400).json({

            error:
                "New password must be at least 6 characters"

        });

    }


    

    const userSql = `

        SELECT
            id,
            password_hash,
            is_active

        FROM users

        WHERE id = ?

        LIMIT 1

    `;


    db.query(
        userSql,
        [user_id],
        async (err, users) => {

            if (err) {

                console.error(
                    "Change password user error:",
                    err
                );

                return res.status(500).json({

                    error:
                        "Server error while checking user"

                });

            }


            /*
            USER DOES NOT EXIST
            */

            if (users.length === 0) {

                return res.status(404).json({

                    error:
                        "User account not found"

                });

            }


            const user = users[0];


            /*
            USER INACTIVE
            */

            if (!user.is_active) {

                return res.status(403).json({

                    error:
                        "This account is inactive"

                });

            }


            

            const passwordMatch =
                await bcrypt.compare(
                    current_password,
                    user.password_hash
                );


            if (!passwordMatch) {

                return res.status(401).json({

                    error:
                        "Current password is incorrect"

                });

            }


            

            const newPasswordHash =
                await bcrypt.hash(
                    new_password,
                    10
                );


            

            const updateSql = `

                UPDATE users

                SET password_hash = ?

                WHERE id = ?

            `;

console.log("Changing password for user ID:", user_id);
            db.query(
                updateSql,
                [
                    newPasswordHash,
                    user_id
                ],
                (err) => {

                    if (err) {

                        console.error(
                            "Update password error:",
                            err
                        );

                        return res.status(500).json({

                            error:
                                "Failed to update password"

                        });

                    }


                    

                    res.json({

                        message:
                            "Password updated successfully"

                    });

                }
            );

        }
    );

});
// ===============================
// USER MANAGEMENT
// ===============================

// GET ALL USERS
app.get("/users", requireRole("admin"), (req, res) => {

    const sql = `
        SELECT
            id,
            name,
            email,
            role,
            is_active,
            created_at
        FROM users
        ORDER BY id DESC
    `;

    db.query(sql, (err, results) => {

        if (err) {
            console.error("Error fetching users:", err);
            return res.status(500).json({
                error: "Failed to fetch users"
            });
        }

        res.json(results);

    });

});


// ADD NEW USER
app.post("/users", requireRole("admin"), async (req, res) => {

    const {
        name,
        email,
        password,
        role
    } = req.body;

    if (!name || !email || !password || !role) {
        return res.status(400).json({
            error: "Name, email, password and role are required"
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            error: "Password must be at least 6 characters"
        });
    }

    const allowedRoles = [
        "admin",
        "manager",
        "cashier",
        "storekeeper",
    ];

    if (!allowedRoles.includes(role)) {
        return res.status(400).json({
            error: "Invalid role"
        });
    }

    try {

        const bcrypt = require("bcrypt");

        const passwordHash =
            await bcrypt.hash(password, 10);

        const sql = `
            INSERT INTO users
            (
                name,
                email,
                password_hash,
                role,
                is_active
            )
            VALUES (?, ?, ?, ?, 1)
        `;

        db.query(
            sql,
            [
                name,
                email,
                passwordHash,
                role
            ],
            (err, result) => {

                if (err) {

                    console.error(
                        "Error adding user:",
                        err
                    );

                    if (err.code === "ER_DUP_ENTRY") {
                        return res.status(409).json({
                            error: "Email address already exists"
                        });
                    }

                    return res.status(500).json({
                        error: "Failed to add user"
                    });

                }

                res.status(201).json({
                    message: "User added successfully",
                    id: result.insertId
                });

            }
        );

    } catch (error) {

        console.error(
            "Error hashing password:",
            error
        );

        res.status(500).json({
            error: "Failed to create user"
        });

    }

});


// UPDATE USER
app.put("/users/:id", requireRole("admin"), async (req, res) => {

    const userId =
        Number(req.params.id);

    const {
        name,
        email,
        role
    } = req.body;

    if (!userId) {
        return res.status(400).json({
            error: "Invalid user ID"
        });
    }

    if (!name || !email || !role) {
        return res.status(400).json({
            error: "Name, email and role are required"
        });
    }

    const allowedRoles = [
        "admin",
        "manager",
        "cashier",
        "storekeeper"
    ];

    if (!allowedRoles.includes(role)) {
        return res.status(400).json({
            error: "Invalid role"
        });
    }

    const sql = `
        UPDATE users
        SET
            name = ?,
            email = ?,
            role = ?
        WHERE id = ?
    `;

    db.query(
        sql,
        [
            name,
            email,
            role,
            userId
        ],
        (err, result) => {

            if (err) {

                console.error(
                    "Error updating user:",
                    err
                );

                if (err.code === "ER_DUP_ENTRY") {
                    return res.status(409).json({
                        error: "Email address already exists"
                    });
                }

                return res.status(500).json({
                    error: "Failed to update user"
                });

            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    error: "User not found"
                });
            }

            res.json({
                message: "User updated successfully"
            });

        }
    );

});


// ACTIVATE / DEACTIVATE USER
app.put("/users/:id/status", requireRole("admin"), (req, res) => {

    const userId =
        Number(req.params.id);

    const {
        is_active
    } = req.body;

    if (!userId) {
        return res.status(400).json({
            error: "Invalid user ID"
        });
    }

    if (
        is_active !== 0 &&
        is_active !== 1 &&
        is_active !== true &&
        is_active !== false
    ) {
        return res.status(400).json({
            error: "Invalid status"
        });
    }

    const activeValue =
        is_active ? 1 : 0;

    const sql = `
        UPDATE users
        SET is_active = ?
        WHERE id = ?
    `;

    db.query(
        sql,
        [
            activeValue,
            userId
        ],
        (err, result) => {

            if (err) {

                console.error(
                    "Error changing user status:",
                    err
                );

                return res.status(500).json({
                    error: "Failed to change user status"
                });

            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    error: "User not found"
                });
            }

            res.json({
                message:
                    activeValue === 1
                        ? "User activated successfully"
                        : "User deactivated successfully"
            });

        }
    );

});


// DELETE USER
app.delete("/users/:id", requireRole("admin"), (req, res) => {

    const userId =
        Number(req.params.id);

    if (!userId) {
        return res.status(400).json({
            error: "Invalid user ID"
        });
    }

    const sql = `
        DELETE FROM users
        WHERE id = ?
    `;

    db.query(
        sql,
        [userId],
        (err, result) => {

            if (err) {

                console.error(
                    "Error deleting user:",
                    err
                );

                return res.status(500).json({
                    error:
                        "Cannot delete this user. They may have sales records."
                });

            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    error: "User not found"
                });
            }

            res.json({
                message: "User deleted successfully"
            });

        }
    );

});
async function getMpesaAccessToken() {

    const consumerKey =
        process.env.MPESA_CONSUMER_KEY;

    const consumerSecret =
        process.env.MPESA_CONSUMER_SECRET;


    const credentials =
        Buffer.from(
            `${consumerKey}:${consumerSecret}`
        ).toString("base64");


    const response = await fetch(
        "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
        {
            method: "GET",

            headers: {
                Authorization:
                    `Basic ${credentials}`
            }
        }
    );


    const data = await response.json();


    if (!response.ok) {
        throw new Error(
            data.errorMessage ||
            "Failed to get M-PESA access token"
        );
    }


    return data.access_token;
}
app.get("/mpesa/test-token", requireRole("admin"), async (req, res) => {

    try {

        await getMpesaAccessToken();

        console.log(
            "M-PESA access token received successfully"
        );

        res.json({
            success: true,
            message: "Connected to Safaricom Daraja successfully"
        });

    } catch (error) {

        console.error(
            "M-PESA OAuth error:",
            error.message
        );

        res.status(500).json({
            success: false,
            error: error.message
        });
    }

});
app.post("/mpesa/stkpush", requireRole("admin", "cashier"), async (req, res) => {

    try {

        const {
            phone,
            amount,
            subtotal,
            discount,
            items
        } = req.body;
        const user_id = req.session.user.id;
        const terminal_id = req.session.user.terminal_id;

console.log("M-PESA SALE DATA:", {
    user_id,
    terminal_id,
    subtotal,
    discount,
    items
});
        // ==========================================
        // 1. VALIDATE DATA
        // ==========================================

        if (!phone || !amount) {

            return res.status(400).json({
                success: false,
                error: "Phone number and amount are required"
            });

        }


        // ==========================================
        // 2. FORMAT PHONE NUMBER
        // 07XXXXXXXX -> 2547XXXXXXXX
        // ==========================================

        const formattedPhone =
            phone.startsWith("0")
                ? "254" + phone.substring(1)
                : phone;


        // ==========================================
        // 3. GET DARAJA ACCESS TOKEN
        // ==========================================

        const accessToken =
            await getMpesaAccessToken();


        // ==========================================
        // 4. CREATE M-PESA TIMESTAMP
        // YYYYMMDDHHmmss
        // ==========================================

        const now = new Date();

        const timestamp =
            now.getFullYear().toString() +
            String(now.getMonth() + 1).padStart(2, "0") +
            String(now.getDate()).padStart(2, "0") +
            String(now.getHours()).padStart(2, "0") +
            String(now.getMinutes()).padStart(2, "0") +
            String(now.getSeconds()).padStart(2, "0");


        // ==========================================
        // 5. GET SHORTCODE + PASSKEY
        // ==========================================

        const shortcode =
            process.env.MPESA_SHORTCODE;

        const passkey =
            process.env.MPESA_PASSKEY;


        // ==========================================
        // 6. CREATE M-PESA PASSWORD
        // ==========================================

        const password =
            Buffer.from(
                shortcode +
                passkey +
                timestamp
            ).toString("base64");


        // ==========================================
        // 7. SEND STK PUSH TO SAFARICOM
        // ==========================================

        const mpesaResponse = await fetch(
            "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
            {
                method: "POST",

                headers: {

                    Authorization:
                        `Bearer ${accessToken}`,

                    "Content-Type":
                        "application/json"

                },

                body: JSON.stringify({

                    BusinessShortCode:
                        shortcode,

                    Password:
                        password,

                    Timestamp:
                        timestamp,

                    TransactionType:
                        "CustomerPayBillOnline",

                    Amount:
                        Math.round(Number(amount)),

                    PartyA:
                        formattedPhone,

                    PartyB:
                        shortcode,

                    PhoneNumber:
                        formattedPhone,

                    CallBackURL:
                        process.env.MPESA_CALLBACK_URL,

                    AccountReference:
                        "SupermarketPOS",

                    TransactionDesc:
                        "POS Payment"

                })
            }
        );


        // ==========================================
        // 8. READ SAFARICOM RESPONSE
        // ==========================================

        const data =
            await mpesaResponse.json();


        console.log(
            "M-PESA STK response:",
            data
        );


        // ==========================================
        // 9. CHECK IF SAFARICOM REJECTED REQUEST
        // ==========================================

        if (!mpesaResponse.ok) {

            return res
                .status(mpesaResponse.status)
                .json({

                    success: false,
                    error: data

                });

        }


        // Also make sure Daraja accepted it
        if (data.ResponseCode !== "0") {

            return res.status(400).json({

                success: false,
                error:
                    data.ResponseDescription ||
                    "M-PESA request was rejected"

            });

        }


        // ==========================================
        // 10. SAVE TRANSACTION AS PENDING
        // ==========================================

        await db.promise().query(
            `
            INSERT INTO mpesa_transactions
            (
                checkout_request_id,
                merchant_request_id,
                phone,
                amount,
                status
            )
            VALUES (?, ?, ?, ?, ?)
            `,
            [
                data.CheckoutRequestID,
                data.MerchantRequestID,
                formattedPhone,
                Math.round(Number(amount)),
                "Pending"
            ]
        );
        await db.promise().query(
    `
    INSERT INTO mpesa_pending_sales
    (
        checkout_request_id,
        user_id,
        terminal_id,
        subtotal,
        discount,
        total,
        items
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
        data.CheckoutRequestID,
        user_id,
        terminal_id,
        subtotal,
        discount || 0,
        amount,
        JSON.stringify(items)
    ]
);


        console.log(
            "M-PESA transaction saved as Pending:",
            data.CheckoutRequestID
        );


        // ==========================================
        // 11. SEND RESPONSE TO POS FRONTEND
        // ==========================================

        res.json({

            success: true,

            message:
                "M-PESA request sent",

            checkoutRequestID:
                data.CheckoutRequestID,

            data: data

        });


    } catch (error) {


        // ==========================================
        // ERROR HANDLING
        // ==========================================

        console.error(
            "STK Push error:",
            error
        );


        res.status(500).json({

            success: false,

            error:
                error.message

        });

    }

});

app.get("/mpesa/status/:checkoutRequestID", requireRole("admin", "cashier"), async (req, res) => {

    try {

        const checkoutRequestID =
            req.params.checkoutRequestID;


        const [rows] =
            await db.promise().query(
                `
                SELECT
                    checkout_request_id,
                    status,
                    result_code,
                    result_description,
                    mpesa_receipt_number,
                    sale_id
                FROM mpesa_transactions
                WHERE checkout_request_id = ?
                `,
                [checkoutRequestID]
            );


        if (rows.length === 0) {

            return res.status(404).json({
                success: false,
                error: "M-PESA transaction not found"
            });

        }


        return res.json({
            success: true,
            transaction: rows[0]
        });


    } catch (error) {

        console.error(
            "M-PESA status error:",
            error
        );


        return res.status(500).json({
            success: false,
            error: "Unable to check M-PESA status"
        });

    }

});

async function completeMpesaSale(
    checkoutRequestID,
    resultCode,
    resultDescription,
    mpesaReceiptNumber = null
) {

    let connection;

    try {

        connection = await db.promise().getConnection();

        await connection.beginTransaction();

        console.log(
            "Completing M-PESA sale:",
            checkoutRequestID
        );


        // ==========================================
        // GET M-PESA TRANSACTION
        // ==========================================

        const [transactionRows] =
            await connection.query(
                `
                SELECT *
                FROM mpesa_transactions
                WHERE checkout_request_id = ?
                FOR UPDATE
                `,
                [checkoutRequestID]
            );


        if (transactionRows.length === 0) {
            throw new Error(
                "M-PESA transaction not found"
            );
        }


        const mpesaTransaction =
            transactionRows[0];


        // ==========================================
        // PREVENT DUPLICATE SALE
        // ==========================================

        if (mpesaTransaction.sale_id) {

            await connection.commit();

            console.log(
                "M-PESA sale already completed:",
                checkoutRequestID,
                "Sale ID:",
                mpesaTransaction.sale_id
            );

            return {
                success: true,
                alreadyCompleted: true,
                saleId: mpesaTransaction.sale_id
            };
        }


        // ==========================================
        // GET PENDING SALE
        // ==========================================

        const [pendingRows] =
            await connection.query(
                `
                SELECT *
                FROM mpesa_pending_sales
                WHERE checkout_request_id = ?
                FOR UPDATE
                `,
                [checkoutRequestID]
            );


        if (pendingRows.length === 0) {
            throw new Error(
                "Pending M-PESA sale not found"
            );
        }


        const pendingSale =
            pendingRows[0];


        let items =
            pendingSale.items;


        if (typeof items === "string") {
            items = JSON.parse(items);
        }


        // ==========================================
        // CHECK USER
        // ==========================================

        const [userRows] =
            await connection.query(
                `
                SELECT id
                FROM users
                WHERE id = ?
                AND is_active = 1
                FOR UPDATE
                `,
                [pendingSale.user_id]
            );


        if (userRows.length === 0) {
            throw new Error(
                "User not found or inactive"
            );
        }


        // ==========================================
        // CHECK TERMINAL
        // ==========================================

        const [terminalRows] =
            await connection.query(
                `
                SELECT id
                FROM terminals
                WHERE id = ?
                AND is_active = 1
                FOR UPDATE
                `,
                [pendingSale.terminal_id]
            );


        if (terminalRows.length === 0) {
            throw new Error(
                "Terminal not found or inactive"
            );
        }


        // ==========================================
        // CHECK PRODUCT STOCK
        // ==========================================

        for (const item of items) {

            const [productRows] =
                await connection.query(
                    `
                    SELECT id, name, stock
                    FROM products
                    WHERE id = ?
                    FOR UPDATE
                    `,
                    [item.product_id]
                );


            if (productRows.length === 0) {
                throw new Error(
                    `Product ${item.product_id} not found`
                );
            }


            const product =
                productRows[0];


            if (
                product.stock <
                item.quantity
            ) {
                throw new Error(
                    `Not enough stock for ${product.name}`
                );
            }
        }


        // ==========================================
        // CREATE SALE
        // ==========================================

        const saleNumber =
            "SALE-" + Date.now();


        const [saleResult] =
            await connection.query(
                `
                INSERT INTO sales
                (
                    sale_number,
                    user_id,
                    terminal_id,
                    payment_method,
                    mpesa_reference,
                    status,
                    subtotal,
                    discount,
                    total
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    saleNumber,
                    pendingSale.user_id,
                    pendingSale.terminal_id,
                    "M-PESA",
                    mpesaReceiptNumber,
                    "Completed",
                    pendingSale.subtotal,
                    pendingSale.discount,
                    pendingSale.total
                ]
            );


        // Get ID of the sale we just created
        const saleId =
            saleResult.insertId;


        // ==========================================
        // CREATE SALE ITEMS + REDUCE STOCK
        // ==========================================

        for (const item of items) {

            const itemSubtotal =
                Number(item.unit_price) *
                Number(item.quantity);


            // Save item in sale_items
            await connection.query(
                `
                INSERT INTO sale_items
                (
                    sale_id,
                    product_id,
                    product_name,
                    quantity,
                    unit_price,
                    subtotal
                )
                VALUES (?, ?, ?, ?, ?, ?)
                `,
                [
                    saleId,
                    item.product_id,
                    item.product_name,
                    item.quantity,
                    item.unit_price,
                    itemSubtotal
                ]
            );


            // Reduce product stock
            const [stockResult] =
                await connection.query(
                    `
                    UPDATE products
                    SET stock = stock - ?
                    WHERE id = ?
                    AND stock >= ?
                    `,
                    [
                        item.quantity,
                        item.product_id,
                        item.quantity
                    ]
                );


            if (
                stockResult.affectedRows === 0
            ) {
                throw new Error(
                    `Unable to reduce stock for product ${item.product_id}`
                );
            }
        }


        // ==========================================
        // MARK M-PESA TRANSACTION COMPLETED
        // ==========================================

        await connection.query(
            `
            UPDATE mpesa_transactions
            SET
                status = 'Completed',
                result_code = ?,
                result_description = ?,
                mpesa_receipt_number = ?,
                sale_id = ?
            WHERE checkout_request_id = ?
            `,
            [
                resultCode,
                resultDescription,
                mpesaReceiptNumber,
                saleId,
                checkoutRequestID
            ]
        );


        // ==========================================
        // DELETE PENDING SALE
        // ==========================================

        await connection.query(
            `
            DELETE FROM mpesa_pending_sales
            WHERE checkout_request_id = ?
            `,
            [checkoutRequestID]
        );


        // ==========================================
        // COMMIT EVERYTHING
        // ==========================================

        await connection.commit();


        console.log(
            "M-PESA SALE COMPLETED:",
            {
                checkoutRequestID,
                saleId,
                saleNumber,
                mpesaReceiptNumber
            }
        );


        return {
            success: true,
            alreadyCompleted: false,
            saleId: saleId,
            saleNumber: saleNumber,
            mpesaReceiptNumber:
                mpesaReceiptNumber
        };


    } catch (error) {

        // ==========================================
        // SOMETHING FAILED — ROLLBACK
        // ==========================================

        if (connection) {

            try {

                await connection.rollback();

            } catch (rollbackError) {

                console.error(
                    "M-PESA rollback error:",
                    rollbackError
                );
            }
        }


        console.error(
            "completeMpesaSale error:",
            error
        );


        throw error;
    } finally {
        if (connection) connection.release();
    }
}

app.post("/mpesa/callback", async (req, res) => {

    try {

        console.log(
            "M-PESA callback received:",
            JSON.stringify(req.body, null, 2)
        );


        const callback =
            req.body?.Body?.stkCallback;


        if (!callback) {

            console.log(
                "Invalid M-PESA callback"
            );

            return res.status(400).json({
                ResultCode: 1,
                ResultDesc: "Invalid callback"
            });
        }


        const checkoutRequestID =
            callback.CheckoutRequestID;

        const resultCode =
            callback.ResultCode;

        const resultDescription =
            callback.ResultDesc;


        // ==========================================
        // FAILED / CANCELLED PAYMENT
        // ==========================================

        if (resultCode !== 0) {

            await db.promise().query(
                `
                UPDATE mpesa_transactions
                SET
                    status = 'Failed',
                    result_code = ?,
                    result_description = ?
                WHERE checkout_request_id = ?
                AND sale_id IS NULL
                `,
                [
                    resultCode,
                    resultDescription,
                    checkoutRequestID
                ]
            );


            console.log(
                "M-PESA PAYMENT FAILED:",
                checkoutRequestID,
                resultDescription
            );


            return res.status(200).json({
                ResultCode: 0,
                ResultDesc:
                    "Callback received successfully"
            });
        }


        // ==========================================
        // SUCCESSFUL PAYMENT
        // ==========================================

        const metadata =
            callback.CallbackMetadata?.Item || [];


        const getMetadataValue = (name) => {

            const item =
                metadata.find(
                    item => item.Name === name
                );

            return item?.Value ?? null;
        };


        const mpesaReceiptNumber =
            getMetadataValue(
                "MpesaReceiptNumber"
            );


        // ==========================================
        // COMPLETE THE POS SALE
        // ==========================================

        const completedSale =
            await completeMpesaSale(
                checkoutRequestID,
                resultCode,
                resultDescription,
                mpesaReceiptNumber
            );


        console.log(
            "M-PESA callback sale result:",
            completedSale
        );


        return res.status(200).json({
            ResultCode: 0,
            ResultDesc:
                "Callback processed successfully"
        });


    } catch (error) {

        console.error(
            "M-PESA CALLBACK ERROR:",
            error
        );


        return res.status(500).json({
            ResultCode: 1,
            ResultDesc:
                "Callback processing failed"
        });
    }
});

app.get("/mpesa/query/:checkoutRequestID", requireRole("admin", "cashier"), async (req, res) => {

    try {

        const checkoutRequestID =
            req.params.checkoutRequestID;

        console.log(
            "Querying Safaricom for:",
            checkoutRequestID
        );

        // Get fresh Daraja access token
        const accessToken =
            await getMpesaAccessToken();


        // Get shortcode and passkey
        const shortcode =
            process.env.MPESA_SHORTCODE;

        const passkey =
            process.env.MPESA_PASSKEY;


        // Create current timestamp
        const now = new Date();

        const timestamp =
            now.getFullYear().toString() +
            String(now.getMonth() + 1).padStart(2, "0") +
            String(now.getDate()).padStart(2, "0") +
            String(now.getHours()).padStart(2, "0") +
            String(now.getMinutes()).padStart(2, "0") +
            String(now.getSeconds()).padStart(2, "0");


        // Create M-PESA password
        const password =
            Buffer.from(
                shortcode +
                passkey +
                timestamp
            ).toString("base64");


        // Ask Safaricom about the original STK Push
        const mpesaResponse = await fetch(
            "https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query",
            {
                method: "POST",

                headers: {
                    Authorization:
                        `Bearer ${accessToken}`,

                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    BusinessShortCode:
                        shortcode,

                    Password:
                        password,

                    Timestamp:
                        timestamp,

                    CheckoutRequestID:
                        checkoutRequestID
                })
            }
        );


        const data =
            await mpesaResponse.json();


        console.log(
            "M-PESA QUERY RESPONSE:",
            data
        );
        // ==========================================
// QUERY CONFIRMED PAYMENT SUCCESS
// ==========================================

if (
    mpesaResponse.ok &&
    String(data.ResultCode) === "0"
) {

    console.log(
        "Safaricom Query confirmed payment:",
        checkoutRequestID
    );


    const completedSale =
        await completeMpesaSale(
            checkoutRequestID,
            data.ResultCode,
            data.ResultDesc,
            null
        );


    console.log(
        "M-PESA sale recovered by Query:",
        completedSale
    );


    return res.status(200).json({
        success: true,
        status: "Completed",
        source: "query",
        sale: completedSale,
        data: data
    });
}


        return res
            .status(mpesaResponse.status)
            .json({
                success: mpesaResponse.ok,
                data: data
            });


    } catch (error) {

        console.error(
            "M-PESA QUERY ERROR:",
            error
        );


        return res.status(500).json({
            success: false,
            error: error.message
        });

    }

});



// GET ALL SUPPLIERS
app.get(
    "/suppliers",
    requireRole("admin", "storekeeper"),
    (req, res) => {

        const sql = `
            SELECT
                id,
                name,
                contact_person,
                phone,
                email,
                location,
                address,
                business_description,
                status,
                created_at,
                updated_at,
                0 AS products_supplied
            FROM suppliers
            ORDER BY created_at DESC
        `;

        db.query(sql, (err, results) => {

            if (err) {
                console.error("Error fetching suppliers:", err);

                return res.status(500).json({
                    error: "Failed to fetch suppliers"
                });
            }

            res.status(200).json(results);

        });

    }
);


// GET ONE SUPPLIER
app.get(
    "/suppliers/:id",
    requireRole("admin", "storekeeper"),
    (req, res) => {

        const supplierId = Number(req.params.id);

        if (!Number.isInteger(supplierId) || supplierId <= 0) {
            return res.status(400).json({
                error: "Invalid supplier ID"
            });
        }

        const sql = `
            SELECT *
            FROM suppliers
            WHERE id = ?
        `;

        db.query(sql, [supplierId], (err, results) => {

            if (err) {
                console.error("Error fetching supplier:", err);

                return res.status(500).json({
                    error: "Failed to fetch supplier"
                });
            }

            if (results.length === 0) {
                return res.status(404).json({
                    error: "Supplier not found"
                });
            }

            const supplier = results[0];

            // These relationships will be connected
            // when the products and purchase orders
            // supplier tables are implemented.

            supplier.products = [];
            supplier.purchase_orders = [];

            res.status(200).json(supplier);

        });

    }
);


// ADD SUPPLIER
app.post(
    "/suppliers",
    requireRole("admin", "storekeeper"),
    (req, res) => {

        let {
            name,
            contact_person,
            phone,
            email,
            location,
            address,
            business_description,
            status
        } = req.body;


        // Clean incoming values
        name = typeof name === "string" ? name.trim() : "";
        phone = typeof phone === "string" ? phone.trim() : "";

        contact_person = contact_person?.trim() || null;
        email = email?.trim() || null;
        location = location?.trim() || null;
        address = address?.trim() || null;
        business_description = business_description?.trim() || null;

        status = status || "Active";


        // Validate required fields
        if (!name || !phone) {
            return res.status(400).json({
                error: "Supplier name and phone are required"
            });
        }

        if (status !== "Active" && status !== "Inactive") {
            return res.status(400).json({
                error: "Invalid supplier status"
            });
        }

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                error: "Invalid email address"
            });
        }


        const sql = `
            INSERT INTO suppliers (
                name,
                contact_person,
                phone,
                email,
                location,
                address,
                business_description,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            name,
            contact_person,
            phone,
            email,
            location,
            address,
            business_description,
            status
        ];

        db.query(sql, values, (err, result) => {

            if (err) {

                console.error("Error adding supplier:", err);

                if (err.code === "ER_DUP_ENTRY") {
                    return res.status(409).json({
                        error: "Supplier name or phone already exists"
                    });
                }

                return res.status(500).json({
                    error: "Failed to add supplier"
                });

            }

            res.status(201).json({
                message: "Supplier added successfully",
                id: result.insertId,
                name,
                contact_person,
                phone,
                email,
                location,
                address,
                business_description,
                status
            });

        });

    }
);


// UPDATE SUPPLIER
app.put(
    "/suppliers/:id",
    requireRole("admin", "storekeeper"),
    (req, res) => {

        const supplierId = Number(req.params.id);

        if (!Number.isInteger(supplierId) || supplierId <= 0) {
            return res.status(400).json({
                error: "Invalid supplier ID"
            });
        }

        let {
            name,
            contact_person,
            phone,
            email,
            location,
            address,
            business_description,
            status
        } = req.body;


        name = typeof name === "string" ? name.trim() : "";
        phone = typeof phone === "string" ? phone.trim() : "";

        contact_person = contact_person?.trim() || null;
        email = email?.trim() || null;
        location = location?.trim() || null;
        address = address?.trim() || null;
        business_description = business_description?.trim() || null;


        if (!name || !phone) {
            return res.status(400).json({
                error: "Supplier name and phone are required"
            });
        }

        if (status !== "Active" && status !== "Inactive") {
            return res.status(400).json({
                error: "Invalid supplier status"
            });
        }

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                error: "Invalid email address"
            });
        }


        const sql = `
            UPDATE suppliers
            SET
                name = ?,
                contact_person = ?,
                phone = ?,
                email = ?,
                location = ?,
                address = ?,
                business_description = ?,
                status = ?
            WHERE id = ?
        `;

        const values = [
            name,
            contact_person,
            phone,
            email,
            location,
            address,
            business_description,
            status,
            supplierId
        ];

        db.query(sql, values, (err, result) => {

            if (err) {

                console.error("Error updating supplier:", err);

                if (err.code === "ER_DUP_ENTRY") {
                    return res.status(409).json({
                        error: "Supplier name or phone already exists"
                    });
                }

                return res.status(500).json({
                    error: "Failed to update supplier"
                });

            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    error: "Supplier not found"
                });
            }

            res.status(200).json({
                message: "Supplier updated successfully",
                id: supplierId
            });

        });

    }
);


// ACTIVATE / DEACTIVATE SUPPLIER
app.patch(
    "/suppliers/:id/status",
    requireRole("admin", "storekeeper"),
    (req, res) => {

        const supplierId = Number(req.params.id);

        const { status } = req.body;


        if (!Number.isInteger(supplierId) || supplierId <= 0) {
            return res.status(400).json({
                error: "Invalid supplier ID"
            });
        }

        if (status !== "Active" && status !== "Inactive") {
            return res.status(400).json({
                error: "Status must be Active or Inactive"
            });
        }


        const sql = `
            UPDATE suppliers
            SET status = ?
            WHERE id = ?
        `;

        db.query(
            sql,
            [status, supplierId],
            (err, result) => {

                if (err) {
                    console.error("Error updating supplier status:", err);

                    return res.status(500).json({
                        error: "Failed to update supplier status"
                    });
                }

                if (result.affectedRows === 0) {
                    return res.status(404).json({
                        error: "Supplier not found"
                    });
                }

                res.status(200).json({
                    message: `Supplier ${status.toLowerCase()} successfully`,
                    id: supplierId,
                    status
                });

            }
        );

    }
);


// GET PURCHASE PRODUCTS
app.get("/purchase-products", async (req, res) => {

    try {

       const [products] = await db.promise().query(`
            SELECT
                p.id,
                p.barcode,
                p.name,
                p.category_id,
                c.name AS category,
                p.price,
                p.last_cost AS lastCost,
                p.stock,
                p.min_stock

            FROM products p

            LEFT JOIN categories c
                ON p.category_id = c.id

            WHERE p.is_active = 1

            ORDER BY p.name ASC
        `);

        res.json(products);

    } catch (error) {

        console.error("Failed to load purchase products:", error);

        res.status(500).json({
            message: "Failed to retrieve purchase products."
        });

    }

});
// CREATE PURCHASE ORDER
app.post("/purchases", requireRole("admin", "storekeeper"), (req, res) => {

    const {
        supplierId,
        orderDate,
        expectedDelivery,
        notes,
        items,
        additionalCosts,
        status
    } = req.body;

    // 1. Validate supplier
    const supplier_id = Number(supplierId);

    if (!Number.isInteger(supplier_id) || supplier_id <= 0) {
        return res.status(400).json({
            error: "Please select a valid supplier."
        });
    }

    // 2. Validate purchase items
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
            error: "Add at least one product to the purchase order."
        });
    }

    // 3. Validate additional costs
    const extraCosts = Number(additionalCosts) || 0;

    if (!Number.isFinite(extraCosts) || extraCosts < 0) {
        return res.status(400).json({
            error: "Additional costs must be a valid positive amount."
        });
    }

    // 4. Validate status
    const statusMap = {
        "draft": "Draft",
        "pending-approval": "Pending Approval"
    };

    const dbStatus = statusMap[status];

    if (!dbStatus) {
        return res.status(400).json({
            error: "Invalid purchase order status."
        });
    }

    // 5. Prepare and validate items
    const preparedItems = [];
    const productIds = new Set();

    let subtotal = 0;
    let discounts = 0;

    for (const item of items) {

        const productId = Number(item.productId);
        const quantity = Number(item.quantity);
        const unitCost = Number(item.unitPrice);
        const discount = Number(item.discount) || 0;

        if (
            !Number.isInteger(productId) ||
            productId <= 0 ||
            !Number.isInteger(quantity) ||
            quantity <= 0 ||
            !Number.isFinite(unitCost) ||
            unitCost < 0 ||
            !Number.isFinite(discount) ||
            discount < 0
        ) {
            return res.status(400).json({
                error: "One or more purchase items contain invalid values."
            });
        }

        // The database does not allow the same product twice
        if (productIds.has(productId)) {
            return res.status(400).json({
                error: "A product appears more than once. Please combine its quantities."
            });
        }

        productIds.add(productId);

        const lineSubtotal = quantity * unitCost;

        if (discount > lineSubtotal) {
            return res.status(400).json({
                error: "An item discount cannot exceed its subtotal."
            });
        }

        subtotal += lineSubtotal;
        discounts += discount;

        preparedItems.push({
            productId,
            quantity,
            unitCost,
            discount,
            subtotal: lineSubtotal
        });
    }

    // 6. Calculate totals on the server
    subtotal = Number(subtotal.toFixed(2));
    discounts = Number(discounts.toFixed(2));

    const grandTotal = Number(
        (subtotal - discounts + extraCosts).toFixed(2)
    );

    // 7. Generate purchase order number
    const orderNumber = `PO-${Date.now()}`;

    // 8. Get authenticated employee
    const createdBy = req.session.user.name;

    // 9. Normalize optional dates
    const validDate = (value) => {
        if (!value) return null;

        return /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? value
            : null;
    };

    const savedOrderDate = validDate(orderDate);
    const savedExpectedDelivery = validDate(expectedDelivery);

    // 10. Begin database transaction
    withCallbackTransaction(res, "Could not start purchase transaction.", (transactionError, connection) => {

        if (transactionError) {
            console.error("Purchase transaction error:", transactionError);

            return res.status(500).json({
                error: "Unable to start purchase order transaction."
            });
        }

        // Roll back helper
        const fail = (httpStatus, message) => {
            connection.rollback(() => {
                res.status(httpStatus).json({
                    error: message
                });
            });
        };

        // 11. Verify supplier exists
        connection.query(
            "SELECT id FROM suppliers WHERE id = ?",
            [supplier_id],
            (supplierError, supplierResults) => {

                if (supplierError) {
                    console.error(supplierError);
                    return fail(500, "Unable to verify supplier.");
                }

                if (supplierResults.length === 0) {
                    return fail(400, "Selected supplier does not exist.");
                }

                // 12. Verify products exist and are active
                connection.query(
                    "SELECT id FROM products WHERE id IN (?) AND is_active = 1",
                    [[...productIds]],
                    (productError, productResults) => {

                        if (productError) {
                            console.error(productError);
                            return fail(500, "Unable to verify purchase products.");
                        }

                        if (productResults.length !== productIds.size) {
                            return fail(
                                400,
                                "One or more selected products do not exist or are inactive."
                            );
                        }

                        // 13. Insert purchase order
                        const purchaseSql = `
                            INSERT INTO purchases (
                                supplier_id,
                                order_number,
                                order_date,
                                expected_delivery,
                                created_by,
                                total_amount,
                                discounts,
                                additional_costs,
                                status,
                                notes
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `;

                        connection.query(
                            purchaseSql,
                            [
                                supplier_id,
                                orderNumber,
                                savedOrderDate,
                                savedExpectedDelivery,
                                createdBy,
                                grandTotal,
                                discounts,
                                extraCosts,
                                dbStatus,
                                notes || ""
                            ],
                            (purchaseError, purchaseResult) => {

                                if (purchaseError) {
                                    console.error(purchaseError);
                                    return fail(500, "Unable to save purchase order.");
                                }

                                const purchaseId = purchaseResult.insertId;

                                // 14. Prepare purchase items
                                const itemValues = preparedItems.map(item => [
                                    purchaseId,
                                    item.productId,
                                    item.quantity,
                                    item.unitCost,
                                    item.subtotal,
                                    item.discount
                                ]);

                                const itemSql = `
                                    INSERT INTO purchase_items (
                                        purchase_id,
                                        product_id,
                                        quantity,
                                        unit_cost,
                                        subtotal,
                                        discount
                                    )
                                    VALUES ?
                                `;

                                // 15. Insert all purchase items
                                connection.query(
                                    itemSql,
                                    [itemValues],
                                    (itemsError) => {

                                        if (itemsError) {
                                            console.error(itemsError);
                                            return fail(500, "Unable to save purchase items.");
                                        }

                                        // 16. Commit transaction
                                        connection.commit((commitError) => {

                                            if (commitError) {
                                                console.error(commitError);

                                                return fail(
                                                    500,
                                                    "Unable to complete purchase order."
                                                );
                                            }

                                            res.status(201).json({
                                                message: "Purchase order saved successfully.",
                                                purchaseId,
                                                orderNumber,
                                                status: dbStatus,
                                                subtotal,
                                                discounts,
                                                additionalCosts: extraCosts,
                                                grandTotal
                                            });

                                        });
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });
});

function getPurchaseReportDateFilter(query) {
    const from = String(query.from || "").trim();
    const to = String(query.to || "").trim();
    const isValidDate = value => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const [year, month, day] = value.split("-").map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        return date.getUTCFullYear() === year &&
            date.getUTCMonth() === month - 1 &&
            date.getUTCDate() === day;
    };

    if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
        return { error: "Please provide valid report dates in YYYY-MM-DD format." };
    }
    if (from && to && from > to) {
        return { error: "The report start date must be before its end date." };
    }

    const conditions = ["LOWER(p.status) <> 'cancelled'"];
    const params = [];
    if (from) {
        conditions.push("p.order_date >= ?");
        params.push(from);
    }
    if (to) {
        conditions.push("p.order_date < DATE_ADD(?, INTERVAL 1 DAY)");
        params.push(to);
    }

    return { whereSql: `WHERE ${conditions.join(" AND ")}`, params };
}

app.get(
    "/purchase-reports/dashboard",
    requireLogin,
    requireRole("admin", "storekeeper"),
    async (req, res) => {
        try {
            const [statsResult, statusResult, recentResult] = await Promise.all([
                db.promise().query(`
                    SELECT
                        COUNT(*) AS totalPurchases,
                        COALESCE(SUM(CASE WHEN DATE(p.created_at) = CURDATE() THEN 1 ELSE 0 END), 0) AS purchasesToday,
                        COALESCE(SUM(CASE WHEN LOWER(p.status) = 'pending approval' THEN 1 ELSE 0 END), 0) AS pendingOrders,
                        COALESCE(SUM(CASE WHEN LOWER(p.status) = 'partially received' THEN 1 ELSE 0 END), 0) AS partiallyReceived,
                        COALESCE(SUM(CASE WHEN LOWER(p.status) <> 'cancelled' THEN GREATEST(p.total_amount - COALESCE(sp.total_paid, 0), 0) ELSE 0 END), 0) AS outstandingPayments
                    FROM purchases p
                    LEFT JOIN (
                        SELECT purchase_id, SUM(amount) AS total_paid
                        FROM supplier_payments
                        GROUP BY purchase_id
                    ) sp ON sp.purchase_id = p.id
                `),
                db.promise().query(`
                    SELECT LOWER(status) AS status, COUNT(*) AS count
                    FROM purchases
                    GROUP BY LOWER(status)
                `),
                db.promise().query(`
                    SELECT
                        p.id,
                        p.order_number AS number,
                        s.name AS supplierName,
                        p.order_date AS orderDate,
                        p.total_amount AS total,
                        p.status
                    FROM purchases p
                    LEFT JOIN suppliers s ON s.id = p.supplier_id
                    ORDER BY p.created_at DESC, p.id DESC
                    LIMIT 5
                `)
            ]);

            const statsRows = statsResult[0];
            const statusRows = statusResult[0];
            const recentRows = recentResult[0];
            const stats = statsRows[0] || {};
            const statusCounts = {
                draft: 0,
                pendingApproval: 0,
                approved: 0,
                partiallyReceived: 0,
                received: 0,
                cancelled: 0
            };
            const statusKeys = {
                draft: "draft",
                "pending approval": "pendingApproval",
                approved: "approved",
                "partially received": "partiallyReceived",
                received: "received",
                cancelled: "cancelled"
            };
            statusRows.forEach(row => {
                const key = statusKeys[String(row.status || "").toLowerCase()];
                if (key) statusCounts[key] = Number(row.count || 0);
            });

            return res.json({
                totalPurchases: Number(stats.totalPurchases || 0),
                purchasesToday: Number(stats.purchasesToday || 0),
                pendingOrders: Number(stats.pendingOrders || 0),
                partiallyReceived: Number(stats.partiallyReceived || 0),
                outstandingPayments: Number(stats.outstandingPayments || 0),
                statusCounts,
                recentOrders: recentRows.map(row => ({
                    id: row.id,
                    number: row.number,
                    supplierName: row.supplierName || "Unknown Supplier",
                    orderDate: row.orderDate,
                    total: Number(row.total || 0),
                    status: row.status
                }))
            });
        } catch (error) {
            console.error("Purchase dashboard error:", error);
            return res.status(500).json({ error: "Failed to load purchase dashboard." });
        }
    }
);

app.get(
    "/purchase-reports/summary",
    requireLogin,
    requireRole("admin", "storekeeper"),
    async (req, res) => {
        const filter = getPurchaseReportDateFilter(req.query);
        if (filter.error) return res.status(400).json({ error: filter.error });

        try {
            const [summaryRows] = await db.promise().query(`
                SELECT
                    COUNT(*) AS orderCount,
                    COALESCE(SUM(p.total_amount), 0) AS totalValue,
                    COALESCE(SUM(COALESCE(sp.total_paid, 0)), 0) AS totalPaid,
                    COALESCE(SUM(GREATEST(p.total_amount - COALESCE(sp.total_paid, 0), 0)), 0) AS outstanding
                FROM purchases p
                LEFT JOIN (
                    SELECT purchase_id, SUM(amount) AS total_paid
                    FROM supplier_payments
                    GROUP BY purchase_id
                ) sp ON sp.purchase_id = p.id
                ${filter.whereSql}
            `, filter.params);

            const summary = summaryRows[0] || {};
            const payload = {
                orderCount: Number(summary.orderCount || 0),
                totalValue: Number(summary.totalValue || 0),
                totalPaid: Number(summary.totalPaid || 0),
                outstanding: Number(summary.outstanding || 0)
            };

            if (req.query.groupBy === "date") {
                const [dateRows] = await db.promise().query(`
                    SELECT
                        DATE_FORMAT(p.order_date, '%Y-%m-%d') AS date,
                        COUNT(*) AS orders,
                        COALESCE(SUM(p.total_amount), 0) AS total
                    FROM purchases p
                    ${filter.whereSql}
                    GROUP BY p.order_date
                    ORDER BY p.order_date ASC
                `, filter.params);
                payload.byDate = dateRows.map(row => ({
                    date: row.date,
                    orders: Number(row.orders || 0),
                    total: Number(row.total || 0)
                }));
            }

            return res.json(payload);
        } catch (error) {
            console.error("Purchase report summary error:", error);
            return res.status(500).json({ error: "Failed to load purchase report summary." });
        }
    }
);

app.get(
    "/purchase-reports/suppliers",
    requireLogin,
    requireRole("admin", "storekeeper"),
    async (req, res) => {
        const outstandingOnly = String(req.query.outstanding || "").toLowerCase() === "true";
        const filter = outstandingOnly
            ? { whereSql: "WHERE LOWER(p.status) <> 'cancelled' AND p.total_amount > COALESCE(sp.total_paid, 0)", params: [] }
            : getPurchaseReportDateFilter(req.query);
        if (filter.error) return res.status(400).json({ error: filter.error });

        try {
            const [rows] = await db.promise().query(outstandingOnly ? `
                SELECT
                    s.name AS supplier,
                    COUNT(DISTINCT p.id) AS openOrders,
                    COALESCE(SUM(GREATEST(p.total_amount - COALESCE(sp.total_paid, 0), 0)), 0) AS balance
                FROM purchases p
                JOIN suppliers s ON s.id = p.supplier_id
                LEFT JOIN (
                    SELECT purchase_id, SUM(amount) AS total_paid
                    FROM supplier_payments
                    GROUP BY purchase_id
                ) sp ON sp.purchase_id = p.id
                ${filter.whereSql}
                GROUP BY s.id, s.name
                ORDER BY balance DESC, s.name ASC
            ` : `
                SELECT
                    s.name AS supplier,
                    COUNT(DISTINCT p.id) AS orders,
                    COALESCE(SUM(p.total_amount), 0) AS total,
                    COALESCE(SUM(COALESCE(sp.total_paid, 0)), 0) AS paid,
                    COALESCE(SUM(GREATEST(p.total_amount - COALESCE(sp.total_paid, 0), 0)), 0) AS outstanding
                FROM purchases p
                JOIN suppliers s ON s.id = p.supplier_id
                LEFT JOIN (
                    SELECT purchase_id, SUM(amount) AS total_paid
                    FROM supplier_payments
                    GROUP BY purchase_id
                ) sp ON sp.purchase_id = p.id
                ${filter.whereSql}
                GROUP BY s.id, s.name
                ORDER BY total DESC, s.name ASC
            `, filter.params);

            const data = rows.map(row => outstandingOnly ? ({
                supplier: row.supplier,
                openOrders: Number(row.openOrders || 0),
                balance: Number(row.balance || 0)
            }) : ({
                supplier: row.supplier,
                orders: Number(row.orders || 0),
                total: Number(row.total || 0),
                paid: Number(row.paid || 0),
                outstanding: Number(row.outstanding || 0)
            }));
            return res.json(data);
        } catch (error) {
            console.error("Purchase report supplier error:", error);
            return res.status(500).json({ error: "Failed to load supplier purchase report." });
        }
    }
);

app.get(
    "/purchase-reports/products",
    requireLogin,
    requireRole("admin", "storekeeper"),
    async (req, res) => {
        const filter = getPurchaseReportDateFilter(req.query);
        if (filter.error) return res.status(400).json({ error: filter.error });

        try {
            const [rows] = await db.promise().query(`
                SELECT
                    pr.name AS product,
                    COALESCE(c.name, 'Uncategorized') AS category,
                    COALESCE(SUM(pi.quantity), 0) AS quantity,
                    COALESCE(SUM(GREATEST(pi.subtotal - COALESCE(pi.discount, 0), 0)), 0) AS cost
                FROM purchase_items pi
                JOIN purchases p ON p.id = pi.purchase_id
                LEFT JOIN products pr ON pr.id = pi.product_id
                LEFT JOIN categories c ON c.id = pr.category_id
                ${filter.whereSql}
                GROUP BY pi.product_id, pr.name, c.name
                ORDER BY quantity DESC, product ASC
                LIMIT 20
            `, filter.params);

            return res.json(rows.map(row => ({
                product: row.product || "Unknown product",
                category: row.category,
                quantity: Number(row.quantity || 0),
                cost: Number(row.cost || 0)
            })));
        } catch (error) {
            console.error("Purchase report product error:", error);
            return res.status(500).json({ error: "Failed to load product purchase report." });
        }
    }
);

/*
==================================================
GET PURCHASE ORDERS (listing with filters, search, pagination)
==================================================
*/
app.get(
    "/purchases",
    requireLogin,
    requireRole("admin", "storekeeper"),
    (req, res) => {

        console.log("Fetching purchase orders...");

        const {
            search = "",
            status = "",
            from = "",
            to = "",
            supplierId = "",
            paymentStatus = "",
            page = 1,
            pageSize = 10
        } = req.query;

        const pageNum = Math.max(parseInt(page, 10) || 1, 1);
        const pageSizeNum = Math.max(parseInt(pageSize, 10) || 10, 1);
        const offset = (pageNum - 1) * pageSizeNum;

        const conditions = [];
        const params = [];

        // Search by PO number or supplier name
        if (search && String(search).trim() !== "") {
            conditions.push(
                `(p.order_number LIKE ? OR s.name LIKE ?)`
            );
            const like = `%${String(search).trim()}%`;
            params.push(like, like);
        }

        // Filter by status
        if (status && String(status).trim() !== "") {
            const statusMap = {
                "draft": "Draft",
                "pending-approval": "Pending Approval",
                "approved": "Approved",
                "partially-received": "Partially Received",
                "received": "Received",
                "completed": "Completed",
                "cancelled": "Cancelled"
            };
            const statusKey = String(status)
                .trim()
                .toLowerCase()
                .replace(/\s+/g, "-");
            const dbStatus = statusMap[statusKey];

            if (!dbStatus) {
                return res.status(400).json({
                    error: "Invalid purchase order status filter."
                });
            }

            conditions.push(`p.status = ?`);
            params.push(dbStatus);
        }

        // Filter by supplier
        if (supplierId && String(supplierId).trim() !== "") {
            conditions.push(`p.supplier_id = ?`);
            params.push(parseInt(supplierId, 10));
        }

        // Filter by date range
        if (from && String(from).trim() !== "") {
            conditions.push(`p.order_date >= ?`);
            params.push(String(from).trim());
        }
        if (to && String(to).trim() !== "") {
            conditions.push(`p.order_date <= ?`);
            params.push(String(to).trim());
        }

        // Filter by payment status
        if (paymentStatus && String(paymentStatus).trim() !== "") {
            const ps = String(paymentStatus).trim();
            if (ps === 'unpaid') {
                conditions.push(`COALESCE(sp.total_paid, 0) = 0`);
            } else if (ps === 'paid') {
                conditions.push(`COALESCE(sp.total_paid, 0) >= p.total_amount`);
            } else if (ps === 'partially-paid') {
                conditions.push(`COALESCE(sp.total_paid, 0) > 0 AND COALESCE(sp.total_paid, 0) < p.total_amount`);
            }
        }

        const whereClause =
            conditions.length > 0
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

        const countSql = `
            SELECT COUNT(*) AS total
            FROM purchases p
            LEFT JOIN suppliers s ON p.supplier_id = s.id
            ${whereClause}
        `;

        const dataSql = `
            SELECT
                p.id,
                p.order_number AS number,
                p.order_date AS orderDate,
                p.expected_delivery AS expectedDelivery,
                p.total_amount AS total,
                p.discounts,
                p.additional_costs AS additionalCosts,
                p.status,
                p.created_at AS createdAt,
                p.notes,
                s.name AS supplierName,
                s.id AS supplierId,
                COALESCE(sp.total_paid, 0) AS amountPaid,
                (p.total_amount - COALESCE(sp.total_paid, 0)) AS outstanding,                
                CASE
                    WHEN COALESCE(sp.total_paid, 0) = 0 THEN 'Unpaid'
                    WHEN COALESCE(sp.total_paid, 0) >= p.total_amount THEN 'Paid'
                    ELSE 'Partially Paid'
                END AS payment_status
            FROM purchases p
            LEFT JOIN suppliers s ON p.supplier_id = s.id
            LEFT JOIN (
                SELECT purchase_id, COALESCE(SUM(amount), 0) AS total_paid
                FROM supplier_payments
                GROUP BY purchase_id
            ) sp ON p.id = sp.purchase_id
            ${whereClause}
            ORDER BY p.created_at DESC, p.id DESC
            LIMIT ? OFFSET ?
        `;

        db.query(countSql, params, (countErr, countResults) => {

            if (countErr) {

                console.error("Error counting purchase orders:", countErr);

                return res.status(500).json({

                    error: "Failed to count purchase orders"

                });

            }

            const total = countResults[0].total;

            const dataParams = [...params, pageSizeNum, offset];

            db.query(dataSql, dataParams, (dataErr, results) => {

                if (dataErr) {

                    console.error("Error fetching purchase orders:", dataErr);

                    return res.status(500).json({

                        error: "Failed to fetch purchase orders"

                    });

                }

                const pages = Math.ceil(total / pageSizeNum);

                res.json({

                    purchases: results,

                    pagination: {

                        total,

                        page: pageNum,

                        pageSize: pageSizeNum,

                        pages,

                        from: total > 0 ? offset + 1 : 0,

                        to: Math.min(offset + pageSizeNum, total)

                    }

                });

            });

        });

    }

);


app.get(
    "/purchases/:id",
    requireLogin,
    requireRole("admin", "storekeeper"),
    (req, res) => {

        const id = req.params.id;

        const sql = `
            SELECT
                p.id,
                p.order_number,
                p.status,
                p.order_date,
                p.expected_delivery,
                p.notes,
                p.total_amount,
                p.discounts,
                p.additional_costs,
                p.created_by,
                p.created_at,
                p.approved_by,
                p.approved_at,
                p.cancelled_by,
                p.cancelled_at,
                p.cancellation_reason,
                p.supplier_id,
                s.name AS supplier_name,
                s.contact_person AS supplier_contact_person,
                s.phone AS supplier_phone,
                s.email AS supplier_email,
                s.address AS supplier_address
            FROM purchases p
            LEFT JOIN suppliers s
                ON p.supplier_id = s.id
            WHERE p.id = ?
            LIMIT 1
        `;

        db.query(sql, [id], (err, rows) => {

            if (err) {
                return res.status(500).json({ error: "Failed to load purchase order" });
            }

            if (!rows || rows.length === 0) {
                return res.status(404).json({ error: "Purchase order not found" });
            }

            const po = rows[0];

            const itemSql = `
                SELECT
                    pi.id,
                    pi.product_id,
                    pr.name AS product_name,
                    pr.barcode,
                    pi.quantity,
                    pi.unit_cost,
                    pi.discount,
                    pi.subtotal,
                    pi.quantity_received AS quantity_received
                FROM purchase_items pi
                LEFT JOIN products pr
                    ON pi.product_id = pr.id
                WHERE pi.purchase_id = ?
                ORDER BY pi.id ASC
            `;

            db.query(itemSql, [id], (itemErr, items) => {

                if (itemErr) {
                    return res.status(500).json({ error: "Failed to load purchase items" });
                }

                res.json({
                    id: po.id,
                    number: po.order_number,
                    status: po.status,
                    orderDate: po.order_date,
                    expectedDelivery: po.expected_delivery,
                    notes: po.notes,
                    subtotal: Number(po.total_amount) - Number(po.discounts || 0) - Number(po.additional_costs || 0),
                    discounts: po.discounts,
                    additionalCosts: po.additional_costs,
                    grandTotal: po.total_amount,
                    createdBy: po.created_by,
                    createdAt: po.created_at,
                    approvedBy: po.approved_by,
                    approvedAt: po.approved_at,
                    cancelledBy: po.cancelled_by,
                    cancelledAt: po.cancelled_at,
                    cancellationReason: po.cancellation_reason,
                    supplier: {
                        id: po.supplier_id,
                        name: po.supplier_name,
                        contactPerson: po.supplier_contact_person,
                        phone: po.supplier_phone,
                        email: po.supplier_email,
                        address: po.supplier_address
                    },
                    items: (items || []).map(item => ({
                        id: item.id,
                        productId: item.product_id,
                        name: item.product_name,
                         barcode: item.barcode,
                        quantityOrdered: item.quantity,
                        quantityReceived: item.quantity_received,
                        unitPrice: item.unit_cost,
                        discount: item.discount,
                        subtotal: item.subtotal
                    }))
                });

            });

        });

    }
);
/*
==================================================
PUT PURCHASE ORDER
Edit existing purchase order.
Does not change product stock.
==================================================
*/

app.put(
    "/purchases/:id",
    requireLogin,
    requireRole("admin", "storekeeper"),
    (req, res) => {

        const purchaseId = Number(req.params.id);

        // 1. Validate purchase ID
        if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
            return res.status(400).json({
                error: "Invalid purchase order ID."
            });
        }

        const {
            supplierId,
            orderDate,
            expectedDelivery,
            notes,
            items,
            additionalCosts,
            status
        } = req.body;

        // 2. Validate supplier
        const supplier_id = Number(supplierId);

        if (!Number.isInteger(supplier_id) || supplier_id <= 0) {
            return res.status(400).json({
                error: "Please select a valid supplier."
            });
        }

        // 3. Validate items
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                error: "Add at least one product to the purchase order."
            });
        }

        // 4. Validate additional costs
        const extraCosts =
            additionalCosts === undefined ||
            additionalCosts === null ||
            additionalCosts === ""
                ? 0
                : Number(additionalCosts);

        if (!Number.isFinite(extraCosts) || extraCosts < 0) {
            return res.status(400).json({
                error: "Additional costs must be a valid non-negative amount."
            });
        }

        // 5. Validate dates
        const validDate = (value) => {

            if (value === undefined || value === null || value === "") {
                return null;
            }

            if (typeof value !== "string") {
                return false;
            }

            const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

            if (!match) {
                return false;
            }

            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);

            const date = new Date(Date.UTC(year, month - 1, day));

            if (
                date.getUTCFullYear() !== year ||
                date.getUTCMonth() !== month - 1 ||
                date.getUTCDate() !== day
            ) {
                return false;
            }

            return value;
        };

        const savedOrderDate = validDate(orderDate);
        const savedExpectedDelivery = validDate(expectedDelivery);

        if (
            savedOrderDate === false ||
            savedExpectedDelivery === false
        ) {
            return res.status(400).json({
                error: "Please provide valid purchase order dates."
            });
        }

        // 6. Prepare purchase items
        const preparedItems = [];
        const productIds = new Set();

        let subtotal = 0;
        let discounts = 0;

        for (const item of items) {

            const productId = Number(item.productId);
            const quantity = Number(item.quantity);
            const unitCost = Number(item.unitPrice);

            const discount =
                item.discount === undefined ||
                item.discount === null ||
                item.discount === ""
                    ? 0
                    : Number(item.discount);

            if (
                !Number.isInteger(productId) ||
                productId <= 0 ||
                !Number.isInteger(quantity) ||
                quantity <= 0 ||
                !Number.isFinite(unitCost) ||
                unitCost < 0 ||
                !Number.isFinite(discount) ||
                discount < 0
            ) {
                return res.status(400).json({
                    error: "One or more purchase items contain invalid values."
                });
            }

            // Prevent duplicate products
            if (productIds.has(productId)) {
                return res.status(400).json({
                    error: "A product appears more than once. Please combine its quantities."
                });
            }

            productIds.add(productId);

            const lineSubtotal = Number(
                (quantity * unitCost).toFixed(2)
            );

            if (discount > lineSubtotal) {
                return res.status(400).json({
                    error: "An item discount cannot exceed its subtotal."
                });
            }

            subtotal += lineSubtotal;
            discounts += discount;

            preparedItems.push({
                productId,
                quantity,
                unitCost,
                discount,
                subtotal: lineSubtotal
            });
        }

        subtotal = Number(subtotal.toFixed(2));
        discounts = Number(discounts.toFixed(2));

        const grandTotal = Number(
            (subtotal - discounts + extraCosts).toFixed(2)
        );

        // 7. Start database transaction
        withCallbackTransaction(res, "Could not start purchase update transaction.", (transactionError, connection) => {

            if (transactionError) {
                console.error(transactionError);

                return res.status(500).json({
                    error: "Unable to start purchase order transaction."
                });
            }

            // Rollback helper
            const fail = (httpStatus, message, error = null) => {

                if (error) {
                    console.error(error);
                }

                connection.rollback(() => {
                    res.status(httpStatus).json({
                        error: message
                    });
                });
            };

            // 8. Lock and verify purchase order
            connection.query(
                `SELECT id, status
                 FROM purchases
                 WHERE id = ?
                 LIMIT 1
                 FOR UPDATE`,
                [purchaseId],
                (statusError, statusRows) => {

                    if (statusError) {
                        return fail(
                            500,
                            "Unable to verify purchase order.",
                            statusError
                        );
                    }

                    if (!statusRows || statusRows.length === 0) {
                        return fail(404, "Purchase order not found.");
                    }

                    const currentStatus = String(
                        statusRows[0].status || ""
                    );

                    if (currentStatus !== "Draft") {
                        return fail(
                            400,
                            "Only draft purchase orders can be edited."
                        );
                    }

                    const statusMap = {
                        "draft": "Draft",
                        "pending-approval": "Pending Approval"
                    };

                    const dbStatus = status ? (statusMap[status] || currentStatus) : currentStatus;

                    // 9. Verify supplier
                    connection.query(
                        "SELECT id FROM suppliers WHERE id = ? LIMIT 1",
                        [supplier_id],
                        (supplierError, supplierResults) => {

                            if (supplierError) {
                                return fail(
                                    500,
                                    "Unable to verify supplier.",
                                    supplierError
                                );
                            }

                            if (!supplierResults || supplierResults.length === 0) {
                                return fail(
                                    400,
                                    "Selected supplier does not exist."
                                );
                            }

                            // 10. Verify active products
                            connection.query(
                                `SELECT id
                                 FROM products
                                 WHERE id IN (?) AND is_active = 1`,
                                [[...productIds]],
                                (productError, productResults) => {

                                    if (productError) {
                                        return fail(
                                            500,
                                            "Unable to verify purchase products.",
                                            productError
                                        );
                                    }

                                    if (
                                        !productResults ||
                                        productResults.length !== productIds.size
                                    ) {
                                        return fail(
                                            400,
                                            "One or more selected products do not exist or are inactive."
                                        );
                                    }

                                    // 11. Update purchase order
                                    const updatePurchaseSql = `
                                        UPDATE purchases
                                        SET
                                            supplier_id = ?,
                                            order_date = ?,
                                            expected_delivery = ?,
                                            total_amount = ?,
                                            discounts = ?,
                                            additional_costs = ?,
                                            status = ?,
                                            notes = ?
                                        WHERE id = ?
                                    `;

                                    connection.query(
                                        updatePurchaseSql,
                                        [
                                            supplier_id,
                                            savedOrderDate,
                                            savedExpectedDelivery,
                                            grandTotal,
                                            discounts,
                                            extraCosts,
                                            dbStatus,
                                            notes || "",
                                            purchaseId
                                        ],
                                        (updateError) => {

                                            if (updateError) {
                                                return fail(
                                                    500,
                                                    "Unable to update purchase order.",
                                                    updateError
                                                );
                                            }

                                            // 12. Replace existing purchase items
                                            connection.query(
                                                `DELETE FROM purchase_items
                                                 WHERE purchase_id = ?`,
                                                [purchaseId],
                                                (deleteError) => {

                                                    if (deleteError) {
                                                        return fail(
                                                            500,
                                                            "Unable to update purchase items.",
                                                            deleteError
                                                        );
                                                    }

                                                    const itemValues = preparedItems.map(item => [
                                                        purchaseId,
                                                        item.productId,
                                                        item.quantity,
                                                        item.unitCost,
                                                        item.subtotal,
                                                        item.discount
                                                    ]);

                                                    const itemSql = `
                                                        INSERT INTO purchase_items (
                                                            purchase_id,
                                                            product_id,
                                                            quantity,
                                                            unit_cost,
                                                            subtotal,
                                                            discount
                                                        )
                                                        VALUES ?
                                                    `;

                                                    connection.query(
                                                        itemSql,
                                                        [itemValues],
                                                        (itemsError) => {

                                                            if (itemsError) {
                                                                return fail(
                                                                    500,
                                                                    "Unable to save purchase items.",
                                                                    itemsError
                                                                );
                                                            }

                                                            // 13. Commit transaction
                                                            connection.commit((commitError) => {

                                                                if (commitError) {
                                                                    return fail(
                                                                        500,
                                                                        "Unable to commit purchase order update.",
                                                                        commitError
                                                                    );
                                                                }

                                                                return res.status(200).json({
                                                                    success: true,
                                                                    message: "Purchase order updated successfully.",
                                                                    id: purchaseId,
                                                                    subtotal,
                                                                    discounts,
                                                                    additionalCosts: extraCosts,
                                                                    grandTotal
                                                                });

                                                            });

                                                        }
                                                    );

                                                }
                                            );

                                        }
                                    );

                                }
                            );

                        }
                    );

                }
            );

        });

    }
);

app.put(
    "/purchases/:id/approve",
    requireLogin,
    requireRole("admin"),
    (req, res) => {

        const purchaseId = Number(req.params.id);

        // Validate purchase ID
        if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
            return res.status(400).json({
                error: "Invalid purchase order ID."
            });
        }

        // Approve only orders awaiting approval
        db.query(
            `UPDATE purchases
             SET status = 'Approved',
                 approved_by = ?,
                 approved_at = NOW()
             WHERE id = ?
             AND status = 'Pending Approval'`,
            [req.session.user.name, purchaseId],
            (error, result) => {

                if (error) {
                    console.error("Purchase approval error:", error);

                    return res.status(500).json({
                        error: "Unable to approve purchase order."
                    });
                }

                if (result.affectedRows === 0) {

                    return db.query(
                        `SELECT id, status
                         FROM purchases
                         WHERE id = ?
                         LIMIT 1`,
                        [purchaseId],
                        (selectError, rows) => {

                            if (selectError) {
                                return res.status(500).json({
                                    error: "Unable to verify purchase order."
                                });
                            }

                            if (!rows || rows.length === 0) {
                                return res.status(404).json({
                                    error: "Purchase order not found."
                                });
                            }

                            return res.status(400).json({
                                error: `This purchase order cannot be approved. Current status: ${rows[0].status}.`
                            });
                        }
                    );
                }

                return res.status(200).json({
                    success: true,
                    message: "Purchase order approved successfully.",
                    purchaseId,
                    status: "Approved"
                });
            }
        );
    }
);

app.put(
    "/purchases/:id/cancel",
    requireLogin,
    requireRole("admin"),
    (req, res) => {

        const purchaseId = Number(req.params.id);
        const reason = req.body.reason;

        // Validate purchase ID
        if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
            return res.status(400).json({
                error: "Invalid purchase order ID."
            });
        }

        // Validate cancellation reason
        if (typeof reason !== "string" || !reason.trim()) {
            return res.status(400).json({
                error: "A cancellation reason is required."
            });
        }

        // Cancel only eligible purchase orders
        db.query(
            `UPDATE purchases
             SET status = 'Cancelled',
                 cancelled_by = ?,
                 cancelled_at = NOW(),
                 cancellation_reason = ?
             WHERE id = ?
             AND status IN ('Draft', 'Pending Approval', 'Approved')`,
            [
                req.session.user.name,
                reason.trim(),
                purchaseId
            ],
            (error, result) => {

                if (error) {
                    console.error("Purchase cancellation error:", error);

                    return res.status(500).json({ 
                        error: "Unable to cancel purchase order."
                    });
                } 

                if (result.affectedRows === 0) {

                    return db.query(
                        `SELECT id, status
                         FROM purchases
                         WHERE id = ?
                         LIMIT 1`,
                        [purchaseId],
                        (selectError, rows) => {

                            if (selectError) {
                                console.error(
                                    "Purchase cancellation verification error:",
                                    selectError
                                );

                                return res.status(500).json({
                                    error: "Unable to verify purchase order."
                                });
                            }

                            if (!rows || rows.length === 0) {
                                return res.status(404).json({
                                    error: "Purchase order not found."
                                });
                            }

                            return res.status(400).json({
                                error: `This purchase order cannot be cancelled. Current status: ${rows[0].status}.`
                            });
                        }
                    );
                }

                return res.status(200).json({
                    success: true,
                    message: "Purchase order cancelled successfully.",
                    purchaseId,
                    status: "Cancelled"
                });
            }
        );
    }
);


app.post(
    "/purchases/:id/receive",
    requireLogin,
    requireRole("admin", "storekeeper"),
    (req, res) => {

        const purchaseId = Number(req.params.id);

        const { receivedAt, items } = req.body;

        // 1. Validate purchase ID
        if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
            return res.status(400).json({
                error: "Invalid purchase order ID."
            });
        }

        // 2. Validate receiving date
        const validDate = (value) => {

            if (typeof value !== "string") {
                return false;
            }

            const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

            if (!match) {
                return false;
            }

            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);

            const date = new Date(Date.UTC(year, month - 1, day));

            return (
                date.getUTCFullYear() === year &&
                date.getUTCMonth() === month - 1 &&
                date.getUTCDate() === day
            );
        };

        if (!validDate(receivedAt)) {
            return res.status(400).json({
                error: "Please provide a valid receiving date."
            });
        }

        // 3. Validate receiving items
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                error: "No receiving items were provided."
            });
        }

        const preparedItems = [];
        const submittedItemIds = new Set();

        let totalAccepted = 0;

        for (const item of items) {

            const purchaseItemId = Number(item.purchaseItemId);
            const quantityDelivered = Number(item.quantityDelivered);
            const quantityReceived = Number(item.quantityReceived);

            if (
                !Number.isInteger(purchaseItemId) ||
                purchaseItemId <= 0 ||
                !Number.isInteger(quantityDelivered) ||
                quantityDelivered < 0 ||
                !Number.isInteger(quantityReceived) ||
                quantityReceived < 0 ||
                quantityReceived > quantityDelivered
            ) {
                return res.status(400).json({
                    error: "One or more receiving quantities are invalid."
                });
            }

            if (submittedItemIds.has(purchaseItemId)) {
                return res.status(400).json({
                    error: "A purchase item was submitted more than once."
                });
            }

            submittedItemIds.add(purchaseItemId);

            totalAccepted += quantityReceived;

            preparedItems.push({
                purchaseItemId,
                quantityDelivered,
                quantityReceived
            });
        }

        if (totalAccepted <= 0) {
            return res.status(400).json({
                error: "At least one item must have an accepted quantity greater than zero."
            });
        }

        // 4. Begin database transaction
        withCallbackTransaction(res, "Could not start goods receiving transaction.", (transactionErr, connection) => {

            if (transactionErr) {
                console.error("Goods receiving transaction error:", transactionErr);

                return res.status(500).json({
                    error: "Could not start goods receiving transaction."
                });
            }

            // Helper for rolling back failed operations
            const rollback = (message, statusCode = 500, error = null) => {

                if (error) {
                    console.error("Goods receiving error:", error);
                }

                return connection.rollback(() => {
                    return res.status(statusCode).json({
                        error: message
                    });
                });
            };

            // 5. Lock and verify purchase order
            connection.query(
                `SELECT id, status
                 FROM purchases
                 WHERE id = ?
                 FOR UPDATE`,
                [purchaseId],
                (purchaseErr, purchases) => {

                    if (purchaseErr) {
                        return rollback(
                            "Failed to verify purchase order.",
                            500,
                            purchaseErr
                        );
                    }

                    if (!purchases || purchases.length === 0) {
                        return rollback(
                            "Purchase order not found.",
                            404
                        );
                    }

                    const purchase = purchases[0];

                    if (
                        !["Approved", "Partially Received"].includes(
                            purchase.status
                        )
                    ) {
                        return rollback(
                            `This purchase order cannot receive goods. Current status: ${purchase.status}.`,
                            400
                        );
                    }

                    // 6. Lock purchase items
                    connection.query(
                        `SELECT
                            id,
                            product_id,
                            quantity,
                            quantity_received,
                            unit_cost
                         FROM purchase_items
                         WHERE purchase_id = ?
                         ORDER BY id ASC
                         FOR UPDATE`,
                        [purchaseId],
                        (itemsErr, purchaseItems) => {

                            if (itemsErr) {
                                return rollback(
                                    "Failed to load purchase items.",
                                    500,
                                    itemsErr
                                );
                            }

                            if (!purchaseItems || purchaseItems.length === 0) {
                                return rollback(
                                    "This purchase order has no items.",
                                    400
                                );
                            }

                            const purchaseItemMap = new Map();

                            purchaseItems.forEach(item => {
                                purchaseItemMap.set(Number(item.id), item);
                            });

                            // 7. Validate submitted items against the purchase
                            for (const item of preparedItems) {

                                const purchaseItem = purchaseItemMap.get(
                                    item.purchaseItemId
                                );

                                if (!purchaseItem) {
                                    return rollback(
                                        "A submitted item does not belong to this purchase order.",
                                        400
                                    );
                                }

                                const outstanding =
                                    Number(purchaseItem.quantity) -
                                    Number(purchaseItem.quantity_received);

                                if (item.quantityReceived > outstanding) {
                                    return rollback(
                                        `Accepted quantity exceeds the outstanding quantity for purchase item ${item.purchaseItemId}. Outstanding quantity: ${outstanding}.`,
                                        400
                                    );
                                }
                            }

                            // 8. Create goods receiving header
                            const receivingDate = receivedAt;

                            connection.query(
                                `INSERT INTO goods_receivings
                                    (purchase_id, received_by, received_at)
                                 VALUES (
                                    ?,
                                    ?,
                                    CONCAT(?, ' ', DATE_FORMAT(NOW(), '%H:%i:%s'))
                                 )`,
                                [
                                    purchaseId,
                                    req.session.user.name,
                                    receivingDate
                                ],
                                (headerErr, headerResult) => {

                                    if (headerErr) {
                                        return rollback(
                                            "Failed to create goods receiving record.",
                                            500,
                                            headerErr
                                        );
                                    }

                                    const receivingId = headerResult.insertId;

                                    // User ID is optional in the current
                                    // session information provided.
                                    const sessionUserId = Number(
                                        req.session.user.id
                                    );

                                    const userId =
                                        Number.isInteger(sessionUserId) &&
                                        sessionUserId > 0
                                            ? sessionUserId
                                            : null;

                                    // 9. Process receiving items one by one
                                    let itemIndex = 0;

                                    const processNextItem = () => {

                                        if (itemIndex >= preparedItems.length) {
                                            return updatePurchaseStatus();
                                        }

                                        const receivedItem = preparedItems[itemIndex];

                                        const purchaseItem = purchaseItemMap.get(
                                            receivedItem.purchaseItemId
                                        );

                                        // Record the delivered and accepted quantities
                                        connection.query(
                                            `INSERT INTO goods_receiving_items
                                                (
                                                    receiving_id,
                                                    purchase_item_id,
                                                    quantity_delivered,
                                                    quantity_received
                                                )
                                             VALUES (?, ?, ?, ?)`,
                                            [
                                                receivingId,
                                                receivedItem.purchaseItemId,
                                                receivedItem.quantityDelivered,
                                                receivedItem.quantityReceived
                                            ],
                                            (receivingItemErr, receivingItemResult) => {

                                                if (receivingItemErr) {
                                                    return rollback(
                                                        "Failed to save receiving item.",
                                                        500,
                                                        receivingItemErr
                                                    );
                                                }

                                                const receivingItemId =
                                                    receivingItemResult.insertId;

                                                const acceptedQuantity =
                                                    receivedItem.quantityReceived;

                                                // No stock changes for rejected or
                                                // undelivered quantities.
                                                if (acceptedQuantity === 0) {
                                                    itemIndex++;
                                                    return processNextItem();
                                                }

                                                // 10. Update quantity received
                                                connection.query(
                                                    `UPDATE purchase_items
                                                     SET quantity_received =
                                                         quantity_received + ?
                                                     WHERE id = ?
                                                     AND purchase_id = ?`,
                                                    [
                                                        acceptedQuantity,
                                                        receivedItem.purchaseItemId,
                                                        purchaseId
                                                    ],
                                                    (updateItemErr) => {

                                                        if (updateItemErr) {
                                                            return rollback(
                                                                "Failed to update purchase item quantity.",
                                                                500,
                                                                updateItemErr
                                                            );
                                                        }

                                                        // 11. Increase product stock
                                                        connection.query(
                                                            `UPDATE products
                                                             SET stock = stock + ?
                                                             WHERE id = ?`,
                                                            [
                                                                acceptedQuantity,
                                                                purchaseItem.product_id
                                                            ],
                                                            (stockErr, stockResult) => {

                                                                if (stockErr) {
                                                                    return rollback(
                                                                        "Failed to update product stock.",
                                                                        500,
                                                                        stockErr
                                                                    );
                                                                }

                                                                if (stockResult.affectedRows !== 1) {
                                                                    return rollback(
                                                                        "Product could not be found while updating stock.",
                                                                        400
                                                                    );
                                                                }

                                                                // 12. Record stock movement
                                                                connection.query(
                                                                    `INSERT INTO stock_movements
                                                                        (
                                                                            product_id,
                                                                            user_id,
                                                                            change_qty,
                                                                            reason,
                                                                            receiving_item_id
                                                                        )
                                                                     VALUES (?, ?, ?, 'restock', ?)`,
                                                                    [
                                                                        purchaseItem.product_id,
                                                                        userId,
                                                                        acceptedQuantity,
                                                                        receivingItemId
                                                                    ],
                                                                    (movementErr) => {

                                                                        if (movementErr) {
                                                                            return rollback(
                                                                                "Failed to record stock movement.",
                                                                                500,
                                                                                movementErr
                                                                            );
                                                                        }

                                                                        itemIndex++;
                                                                        processNextItem();
                                                                    }
                                                                );

                                                            }
                                                        );

                                                    }
                                                );

                                            }
                                        );

                                    };

                                    // 13. Update purchase order status
                                    const updatePurchaseStatus = () => {

                                        connection.query(
                                            `SELECT
                                                quantity,
                                                quantity_received
                                             FROM purchase_items
                                             WHERE purchase_id = ?`,
                                            [purchaseId],
                                            (statusErr, updatedItems) => {

                                                if (statusErr) {
                                                    return rollback(
                                                        "Failed to calculate purchase receiving status.",
                                                        500,
                                                        statusErr
                                                    );
                                                }

                                                const fullyReceived = updatedItems.every(
                                                    item =>
                                                        Number(item.quantity_received) >=
                                                        Number(item.quantity)
                                                );

                                                const newStatus = fullyReceived
                                                    ? "Received"
                                                    : "Partially Received";

                                                connection.query(
                                                    `UPDATE purchases
                                                     SET status = ?
                                                     WHERE id = ?`,
                                                    [
                                                        newStatus,
                                                        purchaseId
                                                    ],
                                                    (purchaseUpdateErr) => {

                                                        if (purchaseUpdateErr) {
                                                            return rollback(
                                                                "Failed to update purchase order status.",
                                                                500,
                                                                purchaseUpdateErr
                                                            );
                                                        }

                                                        // 14. Commit transaction
                                                        connection.commit(commitErr => {

                                                            if (commitErr) {
                                                                return rollback(
                                                                    "Failed to complete goods receiving transaction.",
                                                                    500,
                                                                    commitErr
                                                                );
                                                            }

                                                            return res.status(200).json({
                                                                success: true,
                                                                message: "Goods received successfully.",
                                                                receivingId,
                                                                purchaseId,
                                                                status: newStatus
                                                            });

                                                        });

                                                    }
                                                );

                                            }
                                        );

                                    };

                                    processNextItem();

                                }
                            );

                        }
                    );

                }
            );

        });

    }
);

// ==================================================
// RECORD SUPPLIER PAYMENT
// ==================================================

app.post(
    "/purchases/:id/payments",
    requireLogin,
    requireRole("admin", "storekeeper"),
    (req, res) => {

        const purchaseId = Number(req.params.id);

        // 1. Validate purchase ID
        if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
            return res.status(400).json({
                error: "Invalid purchase order ID."
            });
        }

        // 2. Validate request body
        const {
            amount,
            paymentMethodId,
            paidAt,
            reference
        } = req.body;

        const paymentAmount = Number(amount);
        const methodId = Number(paymentMethodId);

        if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
            return res.status(400).json({
                error: "Payment amount must be a positive number."
            });
        }

        if (!Number.isInteger(methodId) || methodId <= 0) {
            return res.status(400).json({
                error: "A valid payment method is required."
            });
        }

        // 3. Validate optional payment date
        const validDate = (value) => {

            if (typeof value !== "string") {
                return false;
            }

            const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

            if (!match) {
                return false;
            }

            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);

            const date = new Date(Date.UTC(year, month - 1, day));

            return (
                date.getUTCFullYear() === year &&
                date.getUTCMonth() === month - 1 &&
                date.getUTCDate() === day
            );
        };

        if (paidAt !== undefined && paidAt !== null && paidAt !== "" && !validDate(paidAt)) {
            return res.status(400).json({
                error: "Please provide a valid payment date (YYYY-MM-DD)."
            });
        }

        withCallbackTransaction(res, "Could not start payment transaction.", (transactionErr, connection) => {

            if (transactionErr) {
                console.error("Supplier payment transaction error:", transactionErr);

                return res.status(500).json({
                    error: "Could not start payment transaction."
                });
            }

            // Helper for rolling back failed operations
            const rollback = (message, statusCode = 500, error = null) => {

                if (error) {
                    console.error("Supplier payment error:", error);
                }

                return connection.rollback(() => {
                    return res.status(statusCode).json({
                        error: message
                    });
                });
            };

            connection.query(
                `SELECT id, status, total_amount
                 FROM purchases
                 WHERE id = ?
                 FOR UPDATE`,
                [purchaseId],
                (purchaseErr, purchases) => {

                    if (purchaseErr) {
                        return rollback(
                            "Failed to verify purchase order.",
                            500,
                            purchaseErr
                        );
                    }

                    if (!purchases || purchases.length === 0) {
                        return rollback(
                            "Purchase order not found.",
                            404
                        );
                    }

                    const purchase = purchases[0];

                    const payableStatuses = [
                        "Approved",
                        "Partially Received",
                        "Received",
                        "Completed"
                    ];

                    if (!payableStatuses.includes(purchase.status)) {
                        return rollback(
                            `This purchase order cannot receive payments. Current status: ${purchase.status}.`,
                            400
                        );
                    }

                    // 7. Validate payment method exists and is enabled
                    connection.query(
                        `SELECT id, name, is_enabled
                         FROM payment_methods
                         WHERE id = ?`,
                        [methodId],
                        (methodErr, methods) => {

                            if (methodErr) {
                                return rollback(
                                    "Failed to validate payment method.",
                                    500,
                                    methodErr
                                );
                            }

                            if (!methods || methods.length === 0) {
                                return rollback(
                                    "Payment method not found.",
                                    400
                                );
                            }

                            const paymentMethod = methods[0];

                            // 8. Calculate outstanding balance dynamically
                            connection.query(
                                `SELECT COALESCE(SUM(amount), 0) AS total_paid
                                 FROM supplier_payments
                                 WHERE purchase_id = ?`,
                                [purchaseId],
                                (paidErr, paidResults) => {

                                    if (paidErr) {
                                        return rollback(
                                            "Failed to calculate outstanding balance.",
                                            500,
                                            paidErr
                                        );
                                    }

                                    const totalPaid = Number(paidResults[0].total_paid) || 0;
                                    const totalAmount = Number(purchase.total_amount);
                                    const outstandingBalance = totalAmount - totalPaid;

                                    if (paymentAmount > outstandingBalance) {
                                        return rollback(
                                            `Payment amount exceeds the outstanding balance of KSh ${outstandingBalance.toFixed(2)}.`,
                                            400
                                        );
                                    }

                                    // 10. Record the payment
                                    const paymentDate = paidAt || null;
                                    const paymentReference = reference || null;

                                    // User ID from session
                                    const sessionUserId = Number(req.session.user.id);
                                    const userId =
                                        Number.isInteger(sessionUserId) && sessionUserId > 0
                                            ? sessionUserId
                                            : null;

                                    connection.query(
                                        `INSERT INTO supplier_payments
                                            (purchase_id, payment_method_id, amount, reference, paid_at, recorded_by)
                                         VALUES (?, ?, ?, ?, ?, ?)`,
                                        [
                                            purchaseId,
                                            methodId,
                                            paymentAmount,
                                            paymentReference,
                                            paymentDate,
                                            userId
                                        ],
                                        (insertErr, insertResult) => {

                                            if (insertErr) {
                                                return rollback(
                                                    "Failed to record payment.",
                                                    500,
                                                    insertErr
                                                );
                                            }

                                            const newTotalPaid = totalPaid + paymentAmount;
                                            const newOutstanding = totalAmount - newTotalPaid;

                                            // 11. Commit transaction
                                            connection.commit((commitErr) => {

                                                if (commitErr) {
                                                    return rollback(
                                                        "Failed to complete payment transaction.",
                                                        500,
                                                        commitErr
                                                    );
                                                }

                                                return res.status(200).json({
                                                    success: true,
                                                    message: "Payment recorded successfully.",
                                                    paymentId: insertResult.insertId,
                                                    purchaseId,
                                                    amount: paymentAmount,
                                                    paymentMethod: paymentMethod.name,
                                                    outstandingBalance: newOutstanding,
                                                    recordedBy: userId
                                                });

                                            });

                                        }
                                    );

                                }
                            );

                        }
                    );

                }
            );

        });

    }
);
// ==================================================
// GET SUPPLIER PAYMENT HISTORY
// ==================================================

app.get(
    "/purchases/:id/payments",
    requireLogin,
    requireRole("admin", "storekeeper"),
    (req, res) => {

        const purchaseId = Number(req.params.id);

        // 1. Validate purchase ID
        if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
            return res.status(400).json({
                error: "Invalid purchase order ID."
            });
        }

        // 2. Verify purchase order exists
        db.query(
            `SELECT id, total_amount, order_number
             FROM purchases
             WHERE id = ?`,
            [purchaseId],
            (purchaseErr, purchases) => {

                if (purchaseErr) {
                    console.error(
                        "Failed to verify purchase order:",
                        purchaseErr
                    );

                    return res.status(500).json({
                        error: "Failed to verify purchase order."
                    });
                }

                if (!purchases || purchases.length === 0) {
                    return res.status(404).json({
                        error: "Purchase order not found."
                    });
                }

                const purchase = purchases[0];

                const totalAmount = Number(
                    purchase.total_amount || 0
                );

                const poNumber =
                    purchase.order_number || `PO-${purchaseId}`;

                // 3. Retrieve payment records with joins
                db.query(
                    `SELECT
                        sp.id,
                        sp.purchase_id,
                        sp.amount,
                        sp.reference,
                        sp.paid_at,
                        sp.recorded_by,
                        pm.name AS payment_method,
                        u.name AS recorded_by_name

                     FROM supplier_payments sp

                     LEFT JOIN payment_methods pm
                        ON sp.payment_method_id = pm.id

                     LEFT JOIN users u
                        ON sp.recorded_by = u.id

                     WHERE sp.purchase_id = ?

                     ORDER BY sp.paid_at DESC, sp.id DESC`,
                    [purchaseId],
                    (paymentsErr, payments) => {

                        if (paymentsErr) {
                            console.error(
                                "Failed to retrieve payments:",
                                paymentsErr
                            );

                            return res.status(500).json({
                                error: "Failed to retrieve payments."
                            });
                        }

                        // 4. Calculate payment totals
                        const paymentList = Array.isArray(payments)
                            ? payments
                            : [];

                        const previouslyPaid = Number(
                            paymentList.reduce(
                                (sum, p) =>
                                    sum + Number(p.amount || 0),
                                0
                            ).toFixed(2)
                        );

                        const outstanding = Number(
                            (totalAmount - previouslyPaid).toFixed(2)
                        );

                        // 5. Format payment records
                        const formattedPayments = paymentList.map(p => ({
                            id: p.id,
                            purchaseId: p.purchase_id,
                            amount: Number(p.amount || 0),
                            paymentMethod: p.payment_method || "—",
                            reference: p.reference || "—",
                            paidAt: p.paid_at || "—",
                            recordedBy: p.recorded_by_name || "—",
                            poNumber
                        }));

                        // 6. Return response
                        return res.status(200).json({
                            success: true,

                            purchaseId,

                            summary: {
                                totalAmount,
                                previouslyPaid,
                                outstanding
                            },

                            payments: formattedPayments
                        });
                    }
                );
            }
        );
    }
);




app.listen(
    3000,
    () => {

        console.log(
            "pos backend is running on port 3000"
        );

    }
);

backupManager.startBackupScheduler();
