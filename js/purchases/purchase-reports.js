let purchaseReportData = {
    summary: null,
    byDate: [],
    bySupplier: [],
    topProducts: [],
    balances: []
};
let purchaseReportEventsRegistered = false;

async function loadPurchaseDashboard() {
    try {
        const dashboard = await apiRequest("/purchase-reports/dashboard");
        const numberBindings = {
            "dashboard.totalPurchases": dashboard.totalPurchases,
            "dashboard.purchasesToday": dashboard.purchasesToday,
            "dashboard.pendingOrders": dashboard.pendingOrders,
            "dashboard.partiallyReceived": dashboard.partiallyReceived,
            "dashboard.outstandingPayments": dashboard.outstandingPayments
        };

        Object.entries(numberBindings).forEach(([binding, value]) => {
            const element = document.querySelector(`#purchase-dashboard [data-bind="${binding}"]`);
            if (!element) return;
            const digits = binding === "dashboard.outstandingPayments" ? 2 : 0;
            element.textContent = Number(value || 0).toLocaleString("en-KE", {
                minimumFractionDigits: digits,
                maximumFractionDigits: digits
            });
        });

        const statusCounts = dashboard.statusCounts || {};
        Object.entries(statusCounts).forEach(([status, count]) => {
            const element = document.querySelector(
                `#purchase-dashboard [data-bind="dashboard.statusCounts.${status}"]`
            );
            if (element) element.textContent = Number(count || 0).toLocaleString("en-KE");
        });

        const tbody = document.querySelector(
            '#purchase-dashboard [data-list="dashboard.recentOrders"]'
        );
        const template = document.querySelector(
            '#purchase-dashboard template[data-template="dashboard.recentOrders"]'
        );
        if (!tbody || !template) return;

        tbody.querySelectorAll("tr:not([data-state])").forEach(row => row.remove());
        const orders = Array.isArray(dashboard.recentOrders) ? dashboard.recentOrders : [];
        const emptyState = tbody.querySelector('[data-state="empty"]');
        if (emptyState) emptyState.hidden = orders.length > 0;

        orders.forEach(order => {
            const row = template.content.firstElementChild.cloneNode(true);
            const numberLink = row.querySelector('[data-bind="po.number"]');
            const supplierCell = row.querySelector('[data-bind="po.supplierName"]');
            const dateCell = row.querySelector('[data-bind="po.orderDate"]');
            const totalCell = row.querySelector('[data-bind="po.total"]');
            const statusBadge = row.querySelector('[data-bind="po.status"]');

            if (numberLink) {
                numberLink.textContent = order.number || `PO-${order.id}`;
                numberLink.addEventListener("click", event => {
                    event.preventDefault();
                    purchaseState.currentPurchaseId = order.id;
                    window.location.hash = "purchase-order-details";
                });
            }
            if (supplierCell) supplierCell.textContent = order.supplierName || "Unknown Supplier";
            if (dateCell) dateCell.textContent = order.orderDate
                ? String(order.orderDate).slice(0, 10)
                : "—";
            if (totalCell) totalCell.textContent = Number(order.total || 0).toLocaleString("en-KE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
            if (statusBadge) {
                const status = String(order.status || "");
                const statusClass = status.trim().toLowerCase().replace(/\s+/g, "-");
                statusBadge.textContent = status || "—";
                statusBadge.className = `badge badge--${statusClass}`;
            }
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error("Failed to load purchase dashboard:", error);
        if (typeof showMessage === "function") {
            showMessage(error.message || "Unable to load purchase dashboard.");
        }
    }
}

function reportDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function setPurchaseReportRange(range) {
    const fromInput = document.getElementById("rep-from");
    const toInput = document.getElementById("rep-to");
    if (!fromInput || !toInput) return;

    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (range === "week") {
        const daysSinceMonday = (from.getDay() + 6) % 7;
        from.setDate(from.getDate() - daysSinceMonday);
    } else if (range === "month") {
        from.setDate(1);
    }

    fromInput.value = reportDateString(from);
    toInput.value = reportDateString(today);

    document.querySelectorAll('#purchase-reports [data-action="range"]').forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.range === range));
    });
}

function reportQueryString() {
    const params = new URLSearchParams();
    const from = document.getElementById("rep-from")?.value || "";
    const to = document.getElementById("rep-to")?.value || "";
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
}

function reportNumber(value, digits = 2) {
    return Number(value || 0).toLocaleString("en-KE", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
    });
}

function renderPurchaseReportRows(listSelector, templateSelector, rows, fields) {
    const tbody = document.querySelector(`#purchase-reports [data-list="${listSelector}"]`);
    const template = document.querySelector(`#purchase-reports template[data-template="${templateSelector}"]`);
    if (!tbody || !template) return;

    tbody.querySelectorAll("tr:not([data-state])").forEach(row => row.remove());
    const emptyState = tbody.querySelector('[data-state="empty"]');
    if (emptyState) emptyState.hidden = rows.length > 0;

    rows.forEach(data => {
        const row = template.content.firstElementChild.cloneNode(true);
        fields.forEach(({ name, digits }) => {
            const cell = row.querySelector(`[data-bind="row.${name}"]`);
            if (!cell) return;
            const value = data[name];
            cell.textContent = digits === undefined
                ? (value ?? "—")
                : reportNumber(value, digits);
        });
        tbody.appendChild(row);
    });
}

function renderPurchaseReportChart(rows) {
    const chart = document.querySelector('[data-bind="reports.byDate.chart"]');
    if (!chart) return;
    chart.replaceChildren();

    if (!rows.length) {
        chart.textContent = "No purchase activity in this date range.";
        return;
    }

    const maxTotal = Math.max(...rows.map(row => Number(row.total) || 0), 1);
    const bars = document.createElement("div");
    bars.className = "purchase-report-bars";

    rows.forEach(row => {
        const line = document.createElement("div");
        line.className = "purchase-report-bar";
        const label = document.createElement("span");
        label.className = "purchase-report-bar__label";
        label.textContent = row.date;
        const track = document.createElement("span");
        track.className = "purchase-report-bar__track";
        const fill = document.createElement("span");
        fill.className = "purchase-report-bar__fill";
        fill.style.width = `${Math.max(2, (Number(row.total) / maxTotal) * 100)}%`;
        track.appendChild(fill);
        const value = document.createElement("span");
        value.className = "purchase-report-bar__value";
        value.textContent = `KSh ${reportNumber(row.total)}`;
        line.append(label, track, value);
        bars.appendChild(line);
    });

    chart.appendChild(bars);
}

function renderPurchaseReport(data) {
    const summary = data.summary || {};
    const values = {
        "reports.totalValue": reportNumber(summary.totalValue),
        "reports.totalPaid": reportNumber(summary.totalPaid),
        "reports.outstanding": reportNumber(summary.outstanding),
        "reports.orderCount": reportNumber(summary.orderCount, 0)
    };
    Object.entries(values).forEach(([binding, value]) => {
        const element = document.querySelector(`#purchase-reports [data-bind="${binding}"]`);
        if (element) element.textContent = value;
    });

    renderPurchaseReportRows("reports.byDate", "reports.byDate", data.byDate, [
        { name: "date" }, { name: "orders", digits: 0 }, { name: "total" }
    ]);
    renderPurchaseReportRows("reports.bySupplier", "reports.bySupplier", data.bySupplier, [
        { name: "supplier" }, { name: "orders", digits: 0 }, { name: "total" },
        { name: "paid" }, { name: "outstanding" }
    ]);
    renderPurchaseReportRows("reports.topProducts", "reports.topProducts", data.topProducts, [
        { name: "product" }, { name: "category" }, { name: "quantity", digits: 0 }, { name: "cost" }
    ]);
    renderPurchaseReportRows("reports.balances", "reports.balances", data.balances, [
        { name: "supplier" }, { name: "openOrders", digits: 0 }, { name: "balance" }
    ]);
    renderPurchaseReportChart(data.byDate);
}

async function loadPurchaseReports() {
    const fromInput = document.getElementById("rep-from");
    const toInput = document.getElementById("rep-to");
    if (fromInput && toInput && !fromInput.value && !toInput.value) {
        setPurchaseReportRange("month");
    }

    const query = reportQueryString();
    const suffix = query ? `?${query}` : "";
    try {
        const [summary, bySupplier, topProducts, balances] = await Promise.all([
            apiRequest(`/purchase-reports/summary${suffix}${suffix ? "&" : "?"}groupBy=date`),
            apiRequest(`/purchase-reports/suppliers${suffix}`),
            apiRequest(`/purchase-reports/products${suffix}`),
            apiRequest("/purchase-reports/suppliers?outstanding=true")
        ]);

        purchaseReportData = {
            summary,
            byDate: summary.byDate || [],
            bySupplier: Array.isArray(bySupplier) ? bySupplier : [],
            topProducts: Array.isArray(topProducts) ? topProducts : [],
            balances: Array.isArray(balances) ? balances : []
        };
        renderPurchaseReport(purchaseReportData);
    } catch (error) {
        console.error("Failed to load purchase reports:", error);
        if (typeof showMessage === "function") {
            showMessage(error.message || "Unable to load purchase reports.");
        }
    }
}

function exportPurchaseReportCsv() {
    const rows = [
        ["Purchase Report Summary"],
        ["Total purchase value", purchaseReportData.summary?.totalValue || 0],
        ["Total amount paid", purchaseReportData.summary?.totalPaid || 0],
        ["Outstanding balances", purchaseReportData.summary?.outstanding || 0],
        ["Purchase orders", purchaseReportData.summary?.orderCount || 0],
        [],
        ["Purchases by date"],
        ["Date", "Orders", "Total value"],
        ...purchaseReportData.byDate.map(row => [row.date, row.orders, row.total]),
        [],
        ["Purchases by supplier"],
        ["Supplier", "Orders", "Total", "Paid", "Outstanding"],
        ...purchaseReportData.bySupplier.map(row => [row.supplier, row.orders, row.total, row.paid, row.outstanding]),
        [],
        ["Most purchased products"],
        ["Product", "Category", "Quantity", "Cost"],
        ...purchaseReportData.topProducts.map(row => [row.product, row.category, row.quantity, row.cost]),
        [],
        ["Supplier outstanding balances"],
        ["Supplier", "Open orders", "Balance"],
        ...purchaseReportData.balances.map(row => [row.supplier, row.openOrders, row.balance])
    ];
    const csv = rows.map(row => row.map(value => {
        const text = String(value ?? "");
        return `"${text.replace(/"/g, '""')}"`;
    }).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "purchase-report.csv";
    link.click();
    URL.revokeObjectURL(url);
}

function registerPurchaseReportEvents() {
    if (purchaseReportEventsRegistered) return;
    purchaseReportEventsRegistered = true;

    document.querySelectorAll('#purchase-reports [data-action="range"]').forEach(button => {
        button.addEventListener("click", () => {
            setPurchaseReportRange(button.dataset.range);
            loadPurchaseReports();
        });
    });

    document.querySelector('#purchase-reports [data-action="apply-range"]')?.addEventListener("click", () => {
        document.querySelectorAll('#purchase-reports [data-action="range"]').forEach(button => {
            button.setAttribute("aria-pressed", "false");
        });
        loadPurchaseReports();
    });

    document.querySelector('#purchase-reports [data-action="export-csv"]')?.addEventListener("click", exportPurchaseReportCsv);
    document.querySelector('#purchase-reports [data-action="export-pdf"]')?.addEventListener("click", () => window.print());
}
