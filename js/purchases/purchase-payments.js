

/**
 * Purchase order ID requested from another view.
 * Consumed once by initializeSupplierPayments().
 * @type {number|null}
 */
let pendingPaymentPurchaseId = null;



/**
 * Load purchase orders eligible for supplier payments.
 * Statuses: Approved, Partially Received, Received, Completed.
 * @returns {Promise<Array>} Array of purchase order objects.
 */
async function loadPayablePurchases() {
    const payableStatuses = ["approved", "partially-received", "received", "completed"];
    const purchases = [];

    for (const status of payableStatuses) {
        try {
            const resp = await apiRequest(`/purchases?status=${encodeURIComponent(status)}`);
            const list = Array.isArray(resp)
                ? resp
                : resp.purchases || [];
            purchases.push(...list);
        } catch (error) {
            console.error(`Failed to load ${status} purchase orders:`, error);
        }
    }

    return purchases;
}



/**
 * Populate the purchase order selector (#pay-po) with payable orders.
 * @param {Array} purchases - Array of purchase order objects.
 */
function populatePaymentPurchaseSelector(purchases) {
    const select = document.getElementById("pay-po");
    if (!select) {
        console.error("Purchase order selector (pay-po) not found.");
        return;
    }

    // Preserve the placeholder option
    const placeholder = select.querySelector('option[value=""]');
    select.innerHTML = "";
    if (placeholder) {
        select.appendChild(placeholder);
    }

    purchases.forEach(po => {
        const option = document.createElement("option");
        option.value = po.id;
        option.textContent = `${po.number || "PO-" + po.id} — ${
            po.supplierName || "Unknown Supplier"
        }`;
        select.appendChild(option);
    });
}



/**
 * Load enabled payment methods from GET /payment-methods.
 * @returns {Promise<Array>} Array of payment method objects.
 */
async function loadPaymentMethods() {
    try {
        const methods = await apiRequest("/payment-methods");
        return Array.isArray(methods) ? methods : [];
    } catch (error) {
        console.error("Failed to load payment methods:", error);
        showMessage("Unable to load payment methods.");
        return [];
    }
}



/**
 * Populate the payment method select (#pay-method) with loaded methods.
 * @param {Array} methods - Array of payment method objects.
 */
function populatePaymentMethodSelect(methods) {
    const select = document.getElementById("pay-method");
    if (!select) {
        console.error("Payment method select (pay-method) not found.");
        return;
    }

    // Preserve the placeholder option
    const placeholder = select.querySelector('option[value=""]');
    select.innerHTML = "";
    if (placeholder) {
        select.appendChild(placeholder);
    }

    methods.forEach(method => {
        const option = document.createElement("option");
        option.value = method.id;
        option.textContent = method.name;
        select.appendChild(option);
    });
}



let currentPaymentDetailsRequestId = 0;

/**
 * Load purchase order payment details and render supplier info + figures.
 * The purchase details request and the payment history request are handled
 * independently so one failure does not hide data from the other.
 * @param {number} id - Purchase order ID.
 */
async function loadPurchasePaymentDetails(id) {

    const requestId = ++currentPaymentDetailsRequestId;

    const supplierEl = document.getElementById("pay-supplier");
    const phoneEl = document.getElementById("pay-supplier-phone");
    const totalEl = document.querySelector('[data-bind="payment.total"]');
    const previouslyPaidEl = document.querySelector('[data-bind="payment.previouslyPaid"]');
    const outstandingEl = document.querySelector('[data-bind="payment.outstanding"]');

    let po = null;
    let summary = {};

    /* ---- Request 1: purchase order details ---- */

    try {

        po = await apiRequest(`/purchases/${id}`);

        if (requestId !== currentPaymentDetailsRequestId) {
            return;
        }

        if (supplierEl) supplierEl.value = po.supplier?.name || "—";
        if (phoneEl) phoneEl.value = po.supplier?.phone || "—";

    } catch (error) {

        console.error(
            `Failed to load purchase details from GET /purchases/${id}:`,
            error
        );

        if (requestId !== currentPaymentDetailsRequestId) {
            return;
        }

        if (supplierEl) supplierEl.value = "";
        if (phoneEl) phoneEl.value = "";

        showMessage("Unable to load purchase order details.");

    }

    /* ---- Request 2: payment history + summary ---- */

    try {

        const paymentsResp = await apiRequest(`/purchases/${id}/payments`);

        if (requestId !== currentPaymentDetailsRequestId) {
            return;
        }

        summary = paymentsResp.summary || {};

        renderPaymentHistory(paymentsResp.payments || []);

    } catch (error) {

        console.error(
            `Failed to load payment history from GET /purchases/${id}/payments:`,
            error
        );

        if (requestId !== currentPaymentDetailsRequestId) {
            return;
        }

        summary = {};

        renderPaymentHistory([]);

    }

    if (requestId !== currentPaymentDetailsRequestId) {
        return;
    }

    /* ---- Figures: combine summary with purchase details ---- */

    const hasDetails = po !== null;
    const hasSummary = summary.totalAmount != null;

    const total = Number(summary.totalAmount ?? po?.grandTotal ?? po?.total_amount ?? 0);
    const previouslyPaid = summary.previouslyPaid != null
        ? Number(summary.previouslyPaid)
        : null;
    const outstanding = summary.outstanding != null
        ? Number(summary.outstanding)
        : total - (previouslyPaid ?? 0);

    if (totalEl) {
        totalEl.textContent = (hasSummary || hasDetails)
            ? formatCurrency(total)
            : "—";
    }

    if (previouslyPaidEl) {
        previouslyPaidEl.textContent = previouslyPaid != null
            ? formatCurrency(previouslyPaid)
            : (hasDetails ? formatCurrency(0) : "—");
    }

    if (outstandingEl) {
        outstandingEl.textContent = (hasSummary || hasDetails)
            ? formatCurrency(outstanding)
            : "—";
    }

    return po;

}


/**
 * Render payment history rows into the payments table body.
 * @param {Array} payments - Array of payment record objects from backend.
 */
function renderPaymentHistory(payments) {
    const tbody = document.querySelector('[data-list="payments"]');
    const template = document.querySelector('template[data-template="payments"]');

    if (!tbody || !template) {
        return;
    }

    // Clear existing rows (except empty state row and template)
    tbody.querySelectorAll("tr:not([data-state])").forEach(row => row.remove());

    const emptyState = tbody.querySelector('[data-state="empty"]');

    if (!payments || payments.length === 0) {
        if (emptyState) emptyState.hidden = false;
        return;
    }

    if (emptyState) emptyState.hidden = true;

    payments.forEach(payment => {
        const row = template.content.firstElementChild.cloneNode(true);
        // Backend uses: paidAt, poNumber, amount, paymentMethod, reference, recordedBy
        // Frontend binds to: paidAt, poNumber, amount, method, recordedBy
        const paidAt = payment.paidAt;
        row.querySelector('[data-bind="payment.paidAt"]').textContent = paidAt ? String(paidAt).split(/[T ]/)[0] : "—";
        row.querySelector('[data-bind="payment.poNumber"]').textContent = payment.poNumber || "—";
        row.querySelector('[data-bind="payment.amount"]').textContent = formatCurrency(payment.amount || 0);
        row.querySelector('[data-bind="payment.method"]').textContent = payment.paymentMethod || payment.method || "—";
        row.querySelector('[data-bind="payment.recordedBy"]').textContent = payment.recordedBy || "—";
        tbody.appendChild(row);
    });
}



/**
 * Collect form data and submit payment to POST /purchases/:id/payments.
 */
async function recordPurchasePayment() {
    const select = document.getElementById("pay-po");
    const purchaseId = select ? Number(select.value) : null;

    if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
        showMessage("Please select a purchase order.");
        return;
    }

    const amountEl = document.getElementById("pay-amount");
    const amount = Number(amountEl ? amountEl.value : 0);

    if (!Number.isFinite(amount) || amount <= 0) {
        showMessage("Please enter a valid payment amount.");
        return;
    }

    const methodSelect = document.getElementById("pay-method");
    const methodId = methodSelect ? Number(methodSelect.value) : null;

    if (!Number.isInteger(methodId) || methodId <= 0) {
        showMessage("Please select a payment method.");
        return;
    }

    const dateEl = document.getElementById("pay-date");
    const paidAt = dateEl ? dateEl.value : null;

    if (!paidAt) {
        showMessage("Please enter a payment date.");
        return;
    }

    const referenceEl = document.getElementById("pay-reference");
    const reference = referenceEl ? referenceEl.value.trim() : null;

    const btn = document.querySelector('[data-action="record-payment"]');
    if (btn) btn.disabled = true;

    try {
        const result = await apiRequest(
            `/purchases/${purchaseId}/payments`,
            {
                method: "POST",
                body: JSON.stringify({
                    amount,
                    paymentMethodId: methodId,
                    paidAt,
                    reference
                })
            }
        );

        showMessage("Payment recorded successfully.");

        // Clear form fields
        if (amountEl) amountEl.value = "";
        if (referenceEl) referenceEl.value = "";

        // Refresh payment summary for the selected PO
        await loadPurchasePaymentDetails(purchaseId);

    } catch (error) {
        showMessage(error.message || "Failed to record payment.");
    } finally {
        if (btn) btn.disabled = false;
    }
}



/**
 * Register all supplier payments event listeners.
 * Registered only once to avoid duplicates.
 */
function registerPaymentEvents() {
    if (window.__paymentEventsRegistered) {
        return;
    }
    window.__paymentEventsRegistered = true;

    // Record Payment button
    const btn = document.querySelector('[data-action="record-payment"]');
    if (btn) {
        btn.addEventListener("click", recordPurchasePayment);
    }

    // Purchase order selector change — load details when a PO is selected
    const poSelect = document.getElementById("pay-po");
    if (poSelect) {
        poSelect.addEventListener("change", async () => {
            const purchaseId = Number(poSelect.value);
            if (Number.isInteger(purchaseId) && purchaseId > 0) {
                await loadPurchasePaymentDetails(purchaseId);
            } else {
                // Clear fields when no PO selected
                const supEl = document.getElementById("pay-supplier");
                const phoneEl = document.getElementById("pay-supplier-phone");
                if (supEl) supEl.value = "";
                if (phoneEl) phoneEl.value = "";
                const totalEl = document.querySelector('[data-bind="payment.total"]');
                const prevEl = document.querySelector('[data-bind="payment.previouslyPaid"]');
                const outEl = document.querySelector('[data-bind="payment.outstanding"]');
                if (totalEl) totalEl.textContent = "—";
                if (prevEl) prevEl.textContent = "—";
                if (outEl) outEl.textContent = "—";
            }
        });
    }
}



/**
 * Request opening the Supplier Payments view for a specific purchase order.
 * Stores the ID so initializeSupplierPayments() can preselect it.
 * @param {number|string} purchaseId - Purchase order ID.
 */
function openSupplierPayment(purchaseId) {

    const id = Number(purchaseId);

    if (!Number.isInteger(id) || id <= 0) {

        showMessage("Unable to identify purchase order.");

        return;

    }

    pendingPaymentPurchaseId = id;

    // Already on the Supplier Payments view — process immediately,
    // since assigning the same hash fires no hashchange event.
    if (window.location.hash === "#supplier-payments") {

        const pendingId = pendingPaymentPurchaseId;

        pendingPaymentPurchaseId = null;

        selectPaymentPurchase(pendingId);

        return;

    }

    window.location.hash = "supplier-payments";

}



/**
 * Select a purchase order in #pay-po and load its payment details.
 * Adds the option when the order is not part of the payable list.
 * @param {number} purchaseId - Purchase order ID.
 */
async function selectPaymentPurchase(purchaseId) {

    const id = Number(purchaseId);

    if (!Number.isInteger(id) || id <= 0) {

        return;

    }

    const select = document.getElementById("pay-po");

    if (!select) {

        console.error("Purchase order selector (pay-po) not found.");

        return;

    }

    const value = String(id);

    const exists = Array.from(select.options).some(
        option => option.value === value
    );

    try {

        if (!exists) {

            const po = await apiRequest(`/purchases/${id}`);

            const option = document.createElement("option");

            option.value = po.id;

            option.textContent = `${po.number || po.orderNumber || "PO-" + id} — ${
                po.supplier?.name || po.supplierName || "Unknown Supplier"
            }`;

            select.appendChild(option);

        }

        select.value = value;

        await loadPurchasePaymentDetails(id);

    } catch (error) {

        console.error("Failed to select purchase order for payment:", error);

        showMessage(error.message || "Unable to load the purchase order.");

    }

}



async function initializeSupplierPayments() {
    await loadPayablePurchases().then(populatePaymentPurchaseSelector);
    await loadPaymentMethods().then(populatePaymentMethodSelect);
    registerPaymentEvents();

    if (pendingPaymentPurchaseId !== null) {

        const id = pendingPaymentPurchaseId;

        pendingPaymentPurchaseId = null;

        await selectPaymentPurchase(id);

    }
}



/**
 * Register the delegated click listener for the Record Payment button
 * in the Purchase Order Details view. Runs independently of
 * registerPaymentEvents() so it works before Supplier Payments is opened.
 */
function registerOpenSupplierPaymentButton() {

    if (window.__openSupplierPaymentButtonRegistered) {
        return;
    }

    window.__openSupplierPaymentButtonRegistered = true;

    document.addEventListener("click", (event) => {

        const button = event.target.closest(
            '[data-action="open-supplier-payment"]'
        );

        if (!button) {
            return;
        }

        event.preventDefault();

        const state = window.purchaseState ||
            (typeof purchaseState !== "undefined" ? purchaseState : null);

        const id = Number(state?.currentPurchaseId);

        if (!Number.isInteger(id) || id <= 0) {

            showMessage("No purchase order selected.");

            return;

        }

        openSupplierPayment(id);

    });

}

registerOpenSupplierPaymentButton();
