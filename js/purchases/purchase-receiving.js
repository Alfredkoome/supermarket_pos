
const formatDateDDMMYYYY = value => {
    if (!value) return "—";
    const d = String(value).slice(0, 10);
    if (!d) return "—";
    const parts = d.split("-");
    if (parts.length !== 3) return d;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

/**
 * Load purchase orders eligible for receiving
 * (status: Approved or Partially Received).
 * @returns {Promise<Array>} Array of purchase order objects.
 */
async function loadReceivablePurchases() {
    try {
        const [approvedResp, partialResp] = await Promise.all([
            apiRequest("/purchases?status=Approved"),
            apiRequest("/purchases?status=partially-received")
        ]);

        const approved = Array.isArray(approvedResp)
            ? approvedResp
            : approvedResp.purchases || [];
        const partial = Array.isArray(partialResp)
            ? partialResp
            : partialResp.purchases || [];

        return [...approved, ...partial];
    } catch (error) {
        console.error("Failed to load receivable purchases:", error);
        showMessage("Unable to load receivable purchase orders.");
        return [];
    }
}

/**
 * Populate the purchase order selector (#rcv-po) with receivable orders.
 * @param {Array} purchases - Array of purchase order objects.
 */
function populateReceivingPurchaseSelector(purchases) {
    const select = document.getElementById("rcv-po");
    if (!select) {
        console.error("Purchase order selector (rcv-po) not found.");
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
 * Load receiving purchase details and render its items.
 * @param {number} id - Purchase order ID.
 */
async function loadReceivingPurchaseDetails(id) {
    try {
        const po = await apiRequest(`/purchases/${id}`);

        // Populate delivery details fields
        const supplierEl = document.getElementById("rcv-supplier");
        const orderDateEl = document.getElementById("rcv-order-date");
        const expectedEl = document.getElementById("rcv-expected");
        const receivedByEl = document.getElementById("rcv-by");

        if (supplierEl) supplierEl.value = po.supplier?.name || "—";
        if (orderDateEl) orderDateEl.value = po.orderDate
            ? String(po.orderDate).slice(0, 10)
            : "—";
        if (expectedEl) expectedEl.value = po.expectedDelivery
            ? formatDateDDMMYYYY(po.expectedDelivery)
            : "—";
        if (receivedByEl) receivedByEl.value = "—";

        // Render receiving items (exclude fully received)
        renderReceivingItems(po.items || []);

    } catch (error) {
        console.error("Failed to load receiving purchase details:", error);
        showMessage("Unable to load purchase order details for receiving.");
    }
}

/**
 * Render receiving items table, excluding fully received items.
 * @param {Array} items - Array of purchase item objects from GET /purchases/:id.
 */
function renderReceivingItems(items) {
    const tbody = document.querySelector('tbody[data-list="receiving.items"]');
    const template = document.querySelector('template[data-template="receiving.items"]');

    if (!tbody || !template) {
        console.error("Receiving items table or template not found.");
        return;
    }

    // Remove previously rendered rows (except empty state row and template)
    tbody.querySelectorAll("tr:not([data-state])").forEach(row => row.remove());

    const emptyState = tbody.querySelector('[data-state="empty"]');

    // Filter out fully received items
    const receivableItems = items.filter(item => {
        const ordered = Number(item.quantityOrdered || item.quantity || 0);
        const received = Number(item.quantityReceived || 0);
        return received < ordered;
    });

    if (receivableItems.length === 0) {
        if (emptyState) {
            emptyState.hidden = false;
            const title = emptyState.querySelector(".state__title");
            const desc = emptyState.querySelector(".state__desc");
            if (title) title.textContent = "All items received";
            if (desc) desc.textContent = "All products in this purchase order have been fully received.";
        }
        return;
    }

    if (emptyState) emptyState.hidden = true;

    receivableItems.forEach(item => {
        const row = template.content.firstElementChild.cloneNode(true);

        // Use purchase_items.id as the receiving item ID
        row.dataset.itemId = item.id;

        const nameEl = row.querySelector('[data-bind="item.name"]');
        const barcodeEl = row.querySelector('[data-bind="item.barcode"]');
        const orderedEl = row.querySelector('[data-bind="item.quantityOrdered"]');
        const prevReceivedEl = row.querySelector('[data-bind="item.previouslyReceived"]');
        const outstandingEl = row.querySelector('[data-bind="item.outstanding"]');
        const statusEl = row.querySelector('[data-bind="item.lineStatus"]');

        const ordered = Number(item.quantityOrdered || item.quantity || 0);
        const received = Number(item.quantityReceived || 0);
        const outstanding = ordered - received;

        if (nameEl) nameEl.textContent = item.name || "—";
        if (barcodeEl) barcodeEl.textContent = item.barcode || "—";
        if (orderedEl) orderedEl.textContent = ordered;
        if (prevReceivedEl) prevReceivedEl.textContent = received;
        if (outstandingEl) outstandingEl.textContent = outstanding;

        let statusClass, statusText;
        if (outstanding <= 0) {
            statusClass = "badge--line-received";
            statusText = "Fully received";
        } else if (outstanding < ordered) {
            statusClass = "badge--line-partial";
            statusText = "Partially received";
        } else {
            statusClass = "badge--line-outstanding";
            statusText = "Outstanding";
        }
        if (statusEl) {
            statusEl.textContent = statusText;
            statusEl.className = `badge ${statusClass}`;
        }

        const deliveryQtyInput = row.querySelector('[data-field="item.deliveryQty"]');
        const receivingQtyInput = row.querySelector('[data-field="item.receivingQty"]');

        if (deliveryQtyInput) deliveryQtyInput.value = outstanding;
        if (receivingQtyInput) receivingQtyInput.value = 0;

        tbody.appendChild(row);
    });
}


function registerReceivingSelectorEvents() {
    const select = document.getElementById("rcv-po");
    if (!select) return;

    select.addEventListener("change", (event) => {
        const purchaseId = Number(select.value);
        if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
            currentReceivingPurchaseId = null;
            return;
        }
        currentReceivingPurchaseId = purchaseId;
        loadReceivingPurchaseDetails(purchaseId);
    });
}

async function initializeReceiving() {
    const purchases = await loadReceivablePurchases();

    populateReceivingPurchaseSelector(purchases);
    registerReceivingSelectorEvents();

    // Load the purchase order selected from the PO list
    if (currentReceivingPurchaseId) {

        const select = document.getElementById("rcv-po");

        if (select) {
            select.value = String(currentReceivingPurchaseId);
        }

        await loadReceivingPurchaseDetails(currentReceivingPurchaseId);
    }
}
let isReceiving = false;
let currentReceivingPurchaseId = null;
let currentReceivingItems = [];

/**
 * Collect receiving data from all rendered table rows.
 * @returns {Array} Array of { purchaseItemId, quantityDelivered, quantityReceived }.
 */
function collectReceivingData() {
    const rows = document.querySelectorAll('tbody[data-list="receiving.items"] tr:not([data-state])');
    const data = [];

    rows.forEach(row => {
        const purchaseItemId = Number(row.dataset.itemId);
        const deliveryQtyInput = row.querySelector('[data-field="item.deliveryQty"]');
        const receivingQtyInput = row.querySelector('[data-field="item.receivingQty"]');
        const outstandingEl = row.querySelector('[data-bind="item.outstanding"]');

        const quantityDelivered = deliveryQtyInput ? Number(deliveryQtyInput.value) || 0 : 0;
        const quantityReceived = receivingQtyInput ? Number(receivingQtyInput.value) || 0 : 0;
        const outstanding = outstandingEl ? Number(outstandingEl.textContent) || 0 : 0;

        data.push({
            purchaseItemId,
            quantityDelivered,
            quantityReceived,
            outstanding,
            row
        });
    });

    return data;
}

/**
 * Validate all receiving rows.
 * @param {Array} data - Collected receiving data.
 * @returns {boolean} True if valid.
 */
function validateReceivingData(data) {
    if (!data || data.length === 0) {
        showMessage("No receiving lines found. Please select a purchase order first.");
        return false;
    }

    let hasDelivery = false;

    for (const item of data) {
        const { purchaseItemId, quantityDelivered, quantityReceived, outstanding } = item;

        // Delivery quantity must be a positive integer for submitted lines
        if (
            !Number.isInteger(quantityDelivered) ||
            quantityDelivered <= 0
        ) {
            showMessage(`Delivery quantity for item ${purchaseItemId} must be a positive whole number.`);
            return false;
        }

        hasDelivery = true;

        // Accepted quantity must be a non-negative integer
        if (
            !Number.isInteger(quantityReceived) ||
            quantityReceived < 0
        ) {
            showMessage(`Accepted quantity for item ${purchaseItemId} must be a whole number zero or greater.`);
            return false;
        }

        // Accepted quantity cannot exceed delivered quantity
        if (quantityReceived > quantityDelivered) {
            showMessage(`Accepted quantity (${quantityReceived}) cannot exceed delivered quantity (${quantityDelivered}) for item ${purchaseItemId}.`);
            return false;
        }

        // Accepted quantity cannot exceed outstanding ordered quantity
        if (quantityReceived > outstanding) {
            showMessage(`Accepted quantity (${quantityReceived}) cannot exceed outstanding quantity (${outstanding}) for item ${purchaseItemId}.`);
            return false;
        }
    }

    // At least one line must have delivery quantity greater than zero
    if (!hasDelivery) {
        showMessage("At least one line must have a delivery quantity greater than zero.");
        return false;
    }

    return true;
}

/**
 * Build the API submission payload from validated receiving data.
 * @param {number} purchaseId - Selected purchase order ID.
 * @param {string} receivedAt - Receiving date (YYYY-MM-DD).
 * @param {Array} data - Validated receiving data.
 * @returns {Object} Payload object.
 */
function buildReceivingPayload(purchaseId, receivedAt, data) {
    const items = data
        .filter(item => item.quantityDelivered > 0)
        .map(item => ({
            purchaseItemId: item.purchaseItemId,
            quantityDelivered: item.quantityDelivered,
            quantityReceived: item.quantityReceived
        }));

    return {
        receivedAt,
        items
    };
}

/**
 * Open the confirmation modal and populate it with receiving summary.
 * @param {number} purchaseId - Selected purchase order ID.
 * @param {Array} data - Validated receiving data.
 */
function openReceiveConfirmationModal(purchaseId, data) {
    const lineCount = data.filter(item => item.quantityDelivered > 0).length;
    const unitCount = data.reduce((sum, item) => sum + item.quantityReceived, 0);

    const poNumberEl = document.querySelector('[data-bind="receiving.poNumber"]');
    const supplierNameEl = document.querySelector('[data-bind="receiving.supplierName"]');
    const lineCountEl = document.querySelector('[data-bind="receiving.lineCount"]');
    const unitCountEl = document.querySelector('[data-bind="receiving.unitCount"]');

    const select = document.getElementById("rcv-po");
    const selectedOption = select ? select.options[select.selectedIndex] : null;
    const optionText = selectedOption ? selectedOption.textContent : `#${purchaseId}`;
    const parts = optionText.split(" — ");
    const poNumber = parts[0];
    const supplierName = parts.length > 1 ? parts[1] : "—";

    if (poNumberEl) poNumberEl.textContent = poNumber;
    if (supplierNameEl) supplierNameEl.textContent = supplierName;
    if (lineCountEl) lineCountEl.textContent = lineCount;
    if (unitCountEl) unitCountEl.textContent = unitCount;

    const modal = document.getElementById("modal-receive-goods");
    if (modal && typeof modal.showPopover === "function") {
        modal.showPopover();
    }
}

/**
 * Register all receiving button event listeners.
 * Registered only once to avoid duplicates.
 */
function registerReceivingButtonEvents() {
    if (window.__receivingButtonEventsRegistered) {
        return;
    }
    window.__receivingButtonEventsRegistered = true;

    // Receive Goods — opens confirmation modal after validation
    getElements('[data-action="receive-goods"]').forEach(button => {
        button.addEventListener("click", async () => {
            const data = collectReceivingData();
            if (!validateReceivingData(data)) {
                return;
            }

            const receivedAt = document.getElementById("rcv-date") ? document.getElementById("rcv-date").value : "";
            if (!receivedAt) {
                showMessage("Please enter a receiving date.");
                return;
            }

            currentReceivingItems = data;
            openReceiveConfirmationModal(currentReceivingPurchaseId, data);
        });
    });

    // Save Receiving Record — same confirmation workflow as Receive Goods
    getElements('[data-action="save-receiving-record"]').forEach(button => {
        button.addEventListener("click", async () => {
            const data = collectReceivingData();
            if (!validateReceivingData(data)) {
                return;
            }

            const receivedAt = document.getElementById("rcv-date") ? document.getElementById("rcv-date").value : "";
            if (!receivedAt) {
                showMessage("Please enter a receiving date.");
                return;
            }

            currentReceivingItems = data;
            openReceiveConfirmationModal(currentReceivingPurchaseId, data);
        });
    });

    // Confirm receipt — submit to backend
    getElements('[data-action="confirm-receive"]').forEach(button => {
        button.addEventListener("click", async () => {
            if (isReceiving) {
                return;
            }

            const data = currentReceivingItems;
            if (!data || data.length === 0) {
                showMessage("No receiving data to submit.");
                return;
            }

            const receivedAt = document.getElementById("rcv-date") ? document.getElementById("rcv-date").value : "";
            if (!receivedAt) {
                showMessage("Please enter a receiving date.");
                return;
            }

            const payload = buildReceivingPayload(currentReceivingPurchaseId, receivedAt, data);

            isReceiving = true;
            button.disabled = true;

            try {
                const result = await apiRequest(
                    `/purchases/${currentReceivingPurchaseId}/receive`,
                    {
                        method: "POST",
                        body: JSON.stringify(payload)
                    }
                );

                showMessage(result.message || "Goods received successfully.");

                const modal = document.getElementById("modal-receive-goods");
                if (modal && typeof modal.hidePopover === "function") {
                    modal.hidePopover();
                }

                // Reload eligible purchase orders and refresh selector
                await initializeReceiving();

                // Clear receiving table and selected PO
                const tbody = document.querySelector('tbody[data-list="receiving.items"]');
                if (tbody) {
                    tbody.querySelectorAll("tr:not([data-state])").forEach(row => row.remove());
                }
                const emptyState = tbody ? tbody.querySelector('[data-state="empty"]') : null;
                if (emptyState) {
                    emptyState.hidden = false;
                    const title = emptyState.querySelector(".state__title");
                    const desc = emptyState.querySelector(".state__desc");
                    if (title) title.textContent = "No purchase order selected";
                    if (desc) desc.textContent = "Choose an approved purchase order to list the products to receive.";
                }

                const select = document.getElementById("rcv-po");
                if (select) select.value = "";

                const supplierEl = document.getElementById("rcv-supplier");
                const orderDateEl = document.getElementById("rcv-order-date");
                const expectedEl = document.getElementById("rcv-expected");
                const receivedByEl = document.getElementById("rcv-by");
                if (supplierEl) supplierEl.value = "";
                if (orderDateEl) orderDateEl.value = "";
                if (expectedEl) expectedEl.value = "";
                if (receivedByEl) receivedByEl.value = "";

                currentReceivingPurchaseId = null;
                currentReceivingItems = [];

            } catch (error) {
                showMessage(error.message || "Unable to receive goods.");
            } finally {
                isReceiving = false;
                button.disabled = false;
            }
        });
    });

    // Cancel receiving — navigate back to purchase orders
    getElements('[data-action="cancel-receiving"]').forEach(button => {
        button.addEventListener("click", () => {
            currentReceivingPurchaseId = null;
            currentReceivingItems = [];
            window.location.hash = "purchase-orders";
        });
    });

    // Receive PO from listing — navigate to receiving view and select that PO (delegated for dynamic rows)
    document.addEventListener("click", (event) => {
        const button = event.target.closest('[data-action="receive-po"]');
        if (!button) return;
        event.preventDefault();

        let purchaseId = null;

        
        const row = button.closest("tr");
        if (row) {
            purchaseId = Number(row.dataset.id);
        }

        if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
            purchaseId = Number(purchaseState?.currentPurchaseId);
        }

        if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
            showMessage("Unable to identify purchase order.");
            return;
        }

        currentReceivingPurchaseId = purchaseId;
        window.location.hash = "goods-receiving";
    });
}

/**
 * Initialize all receiving button events.
 * Called once during application startup.
 */
function initializeReceivingButtons() {
    registerReceivingButtonEvents();
}
