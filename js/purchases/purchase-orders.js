async function openPurchaseDetails(id) {

    purchaseState.currentPurchaseId = id;

    try {

        const po = await apiRequest(`/purchases/${id}`);

        const bind = (selector, value) => {
            document.querySelectorAll(selector).forEach(el => {
                el.textContent = value ?? "—";
            });
        };

        const formatAuditDate = value => {
            if (!value) return "—";
            return new Intl.DateTimeFormat("en-KE", {
                timeZone: "Africa/Nairobi",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit"
            }).format(new Date(value));
        };

        const formatDateDDMMYYYY = value => {
            if (!value) return "—";
            const d = String(value).slice(0, 10);
            if (!d) return "—";
            const parts = d.split("-");
            if (parts.length !== 3) return d;
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        };

        bind('[data-bind="po.number"]', po.number);
        bind('[data-bind="po.status"]', po.status);
        bind('[data-bind="po.statusLabel"]', po.status);
        const detailContainer = document.querySelector("#purchase-order-details .po-detail");
        if (detailContainer) {
            detailContainer.dataset.status = String(po.status || "")
                .trim()
                .toLowerCase()
                .replace(/\s+/g, "-");
        }
        bind('[data-bind="po.paymentStatus"]', "—");
        const expectedValue = po.expectedDelivery || po.expected_delivery;
        const orderValue = po.orderDate || po.order_date;

        const detailExpected = document.querySelector('#purchase-order-details [data-bind="po.expectedDelivery"]');
        if (detailExpected) detailExpected.textContent = expectedValue ? formatDateDDMMYYYY(expectedValue) : "—";

        const detailOrderDate = document.querySelector('#purchase-order-details [data-bind="po.orderDate"]');
        if (detailOrderDate) detailOrderDate.textContent = orderValue ? String(orderValue).slice(0, 10) : "—";
        bind('[data-bind="po.createdBy"]', po.createdBy || "—");
        bind('[data-bind="po.createdAt"]', formatAuditDate(po.createdAt));
        bind('[data-bind="po.approvedBy"]', po.approvedBy || "—");
        bind('[data-bind="po.approvedAt"]', formatAuditDate(po.approvedAt));
        bind('[data-bind="po.cancelledBy"]', po.cancelledBy || "—");
        bind('[data-bind="po.cancelReason"]', po.cancellationReason || "—");
        bind('[data-bind="po.notes"]', po.notes || "—");
        bind('[data-bind="po.subtotal"]', Number(po.subtotal || 0).toFixed(2));
        bind('[data-bind="po.discounts"]', Number(po.discounts || 0).toFixed(2));
        bind('[data-bind="po.additionalCosts"]', Number(po.additionalCosts || 0).toFixed(2));
        bind('[data-bind="po.grandTotal"]', Number(po.grandTotal || 0).toFixed(2));
        bind('[data-bind="po.amountPaid"]', "0.00");
        bind('[data-bind="po.outstanding"]', Number(po.grandTotal || 0).toFixed(2));

        bind('[data-bind="po.supplier.name"]', po.supplier?.name || "—");
        bind('[data-bind="po.supplier.contactPerson"]', po.supplier?.contactPerson || "—");
        bind('[data-bind="po.supplier.phone"]', po.supplier?.phone || "—");
        bind('[data-bind="po.supplier.email"]', po.supplier?.email || "—");
        bind('[data-bind="po.supplier.address"]', po.supplier?.address || "—");

        const tbody = document.querySelector('#purchase-order-details tbody[data-list="po.items"]');
        const template = document.querySelector('#purchase-order-details template[data-template="po.detailItems"]');

        if (tbody && template) {

            tbody.querySelectorAll("tr:not(.state-row)").forEach(row => row.remove());

            if (!po.items || po.items.length === 0) {
                const emptyRow = tbody.querySelector('[data-state="empty"]');
                if (emptyRow) emptyRow.hidden = false;
            } else {
                const emptyRow = tbody.querySelector('[data-state="empty"]');
                if (emptyRow) emptyRow.hidden = true;

                po.items.forEach(item => {
                    const row = template.content.firstElementChild.cloneNode(true);
                    row.querySelector('[data-bind="item.name"]').textContent = item.name || "—";
                    row.querySelector('[data-bind="item.barcode"]').textContent = item.barcode || "—";
                    row.querySelector('[data-bind="item.quantityOrdered"]').textContent = item.quantityOrdered || 0;
                    row.querySelector('[data-bind="item.quantityReceived"]').textContent = item.quantityReceived || 0;
                    row.querySelector('[data-bind="item.unitPrice"]').textContent = Number(item.unitPrice || 0).toFixed(2);
                    row.querySelector('[data-bind="item.discount"]').textContent = Number(item.discount || 0).toFixed(2);
                    row.querySelector('[data-bind="item.subtotal"]').textContent = Number(item.subtotal || 0).toFixed(2);
                    tbody.appendChild(row);
                });
            }

        }

    } catch (error) {

        console.error("Failed to load purchase details:", error);

        showMessage("Failed to load purchase order details.");

    }

}

function initializePurchaseOrder() {

    if (!purchaseDOM.orderDate) {

        console.warn("Purchase order date field was not found.");

        return;

    }

    // Set today's date
    const today = new Date().toISOString().split("T")[0];

    purchaseOrder.orderDate = today;

    purchaseDOM.orderDate.value = today;


    // Read expected delivery date
    if (purchaseDOM.expectedDelivery) {

        purchaseOrder.expectedDelivery =
            purchaseDOM.expectedDelivery.value;

    }



    if (purchaseDOM.notes) {

        purchaseOrder.notes = purchaseDOM.notes.value;

    }



    if (purchaseDOM.additionalCosts) {

        purchaseOrder.additionalCosts =
            Number(purchaseDOM.additionalCosts.value) || 0;

    }

}

async function editPurchaseOrder(id) {

    const purchaseId = Number(id);

    if (!Number.isInteger(purchaseId) || purchaseId <= 0) {

        showMessage("Invalid purchase order ID.");

        return;

    }

    try {

        const po = await apiRequest(`/purchases/${purchaseId}`);

        isEditMode = true;
        editingPurchaseId = purchaseId;

        await loadSuppliers();

        purchaseOrder.supplierId = po.supplier?.id || "";

        const supplierOption = Array.from(purchaseDOM.supplierSelect.options).find(
            option => option.value == (po.supplier?.id || "")
        );

        if (supplierOption) {

            purchaseDOM.supplierSelect.value = po.supplier.id;

            purchaseDOM.supplierSelect.dispatchEvent(new Event("change"));

        }

        purchaseOrder.supplier = {

            name: po.supplier?.name || "",
            contactPerson: po.supplier?.contactPerson || "",
            phone: po.supplier?.phone || "",
            email: po.supplier?.email || "",
            address: po.supplier?.address || "",
            outstandingBalance: 0

        };

        purchaseOrder.number = po.number || "";

        purchaseOrder.createdBy = po.createdBy || "";

        purchaseOrder.orderDate = po.orderDate
            ? String(po.orderDate).slice(0, 10)
            : "";

        purchaseOrder.expectedDelivery = po.expectedDelivery
            ? String(po.expectedDelivery).slice(0, 10)
            : "";

        purchaseOrder.notes = po.notes || "";

        purchaseOrder.additionalCosts = Number(po.additionalCosts || 0);

        purchaseOrder.items = (po.items || []).map(item => ({

            productId: item.productId,
            name: item.name,
            barcode: item.barcode,
            quantity: item.quantityOrdered,
            unitPrice: item.unitPrice,
            discount: item.discount,
            subtotal: item.subtotal

        }));

        if (purchaseDOM.orderDate) {
            purchaseDOM.orderDate.value = purchaseOrder.orderDate;
        }

        if (purchaseDOM.expectedDelivery) {
            purchaseDOM.expectedDelivery.value = purchaseOrder.expectedDelivery;
        }

        if (purchaseDOM.notes) {
            purchaseDOM.notes.value = purchaseOrder.notes;
        }

        if (purchaseDOM.additionalCosts) {
            purchaseDOM.additionalCosts.value = purchaseOrder.additionalCosts;
        }

        renderPurchaseOrderItems();
        calculatePurchaseOrderTotals();
        updatePurchaseOrderSummary();

        window.location.hash = "create-purchase-order";

    } catch (error) {

        console.error("Failed to load purchase order for editing:", error);

        showMessage(
            error.message || "Unable to load purchase order for editing."
        );

    }

}

function validatePurchaseOrder() {

    if (!purchaseOrder.supplierId) {

        showMessage("Please select a supplier.");

        return false;

    }


    if (!purchaseOrder.orderDate) {

        showMessage("Please select an order date.");

        return false;

    }


    if (purchaseOrder.items.length === 0) {

        showMessage("Please add at least one product.");

        return false;

    }
    // Validate each product
    for (const item of purchaseOrder.items) {

        if (Number(item.quantity) <= 0) {
            showMessage(`Enter a valid quantity for ${item.name}.`);
            return false;
        }

        if (Number(item.unitPrice) <= 0) {
            showMessage(`Enter the purchase cost for ${item.name}.`);
            return false;
        }

    }


    if (purchaseOrder.additionalCosts < 0) {

        showMessage("Additional costs cannot be negative.");

        return false;

    }


    return true;

}


function capturePurchaseOrderDetails() {
    if (purchaseDOM.supplierSelect) {
        purchaseOrder.supplierId = purchaseDOM.supplierSelect.value;
    }
    if (purchaseDOM.orderDate) {
        purchaseOrder.orderDate = purchaseDOM.orderDate.value;
    }
    if (purchaseDOM.expectedDelivery) {
        purchaseOrder.expectedDelivery = purchaseDOM.expectedDelivery.value;
    }
    if (purchaseDOM.notes) {
        purchaseOrder.notes = purchaseDOM.notes.value;
    }
    if (purchaseDOM.additionalCosts) {
        purchaseOrder.additionalCosts = Number(purchaseDOM.additionalCosts.value) || 0;
    }

    const rows = Array.from(document.querySelectorAll(
        '#create-purchase-order tbody[data-list="po.items"] tr[data-product-id]'
    ));
    purchaseOrder.items = rows.map(row => {
        const productId = Number(row.dataset.productId);
        const existingItem = purchaseOrder.items.find(item =>
            Number(item.productId) === productId
        ) || {};
        const quantityInput = row.querySelector('[data-field="item.quantity"]');
        const priceInput = row.querySelector('[data-field="item.unitPrice"]');
        const discountInput = row.querySelector('[data-field="item.discount"]');
        const quantity = Number(quantityInput?.value) || 0;
        const unitPrice = priceInput?.value ?? existingItem.unitPrice ?? "";
        const discount = Number(discountInput?.value) || 0;

        return {
            ...existingItem,
            productId,
            quantity,
            unitPrice,
            discount,
            subtotal: quantity * (Number(unitPrice) || 0) - discount
        };
    });
}




function calculatePurchaseOrderTotals() {

    let subtotal = 0;

    let discounts = 0;


    purchaseOrder.items.forEach(item => {

        const quantity = Number(item.quantity) || 0;

        const unitPrice = Number(item.unitPrice) || 0;

        const discount = Number(item.discount) || 0;


        subtotal += quantity * unitPrice;

        discounts += discount;

    });


    purchaseOrder.subtotal = subtotal;

    purchaseOrder.discounts = discounts;

    purchaseOrder.grandTotal =
        subtotal - discounts + purchaseOrder.additionalCosts;


    updatePurchaseOrderSummary();

    

}



function updatePurchaseOrderSummary() {
    console.log("ELEMENT:", purchaseDOM.grandTotal);
console.log("VALUE:", purchaseOrder.grandTotal);

    // Update subtotal
    if (purchaseDOM.subtotal) {
        purchaseDOM.subtotal.textContent =
            formatCurrency(purchaseOrder.subtotal);
    }

    // Update discounts
    if (purchaseDOM.discounts) {
        purchaseDOM.discounts.textContent =
            formatCurrency(purchaseOrder.discounts);
    }

    // Update additional costs
    if (purchaseDOM.additionalCosts) {
        purchaseDOM.additionalCosts.value =
            purchaseOrder.additionalCosts;
    }
    updateGrandTotalDisplay();

}


function updateGrandTotalDisplay() {

    const grandTotalElement =
        document.getElementById("purchaseGrandTotal");

    if (!grandTotalElement) {
        console.error("Grand Total element not found!");
        return;
    }

    grandTotalElement.textContent =
        Number(purchaseOrder.grandTotal).toLocaleString("en-KE", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
}


function registerPurchaseOrderEvents() {

    
    purchaseDOM.orderDate?.addEventListener("change", () => {

        purchaseOrder.orderDate = purchaseDOM.orderDate.value;

    });


   
    purchaseDOM.expectedDelivery?.addEventListener("change", () => {

        purchaseOrder.expectedDelivery =
            purchaseDOM.expectedDelivery.value;

    });


    purchaseDOM.notes?.addEventListener("input", () => {

        purchaseOrder.notes = purchaseDOM.notes.value;

    });


    purchaseDOM.additionalCosts?.addEventListener("input", () => {

        purchaseOrder.additionalCosts =
            Number(purchaseDOM.additionalCosts.value) || 0;

        calculatePurchaseOrderTotals();

    });

}


let isSaving = false;



function resetPurchaseOrder() {

    // Reset supplier selection
    purchaseOrder.supplierId = "";

    purchaseOrder.supplier = {

        name: "",

        contactPerson: "",

        phone: "",

        email: "",

        address: "",

        outstandingBalance: 0

    };

    // Clear supplier dropdown and info fields
    if (purchaseDOM.supplierSelect) {

        purchaseDOM.supplierSelect.value = "";

    }

    if (purchaseDOM.supplierName) purchaseDOM.supplierName.value = "";

    if (purchaseDOM.supplierContact) purchaseDOM.supplierContact.value = "";

    if (purchaseDOM.supplierPhone) purchaseDOM.supplierPhone.value = "";

    if (purchaseDOM.supplierEmail) purchaseDOM.supplierEmail.value = "";

    if (purchaseDOM.supplierAddress) purchaseDOM.supplierAddress.value = "";


    purchaseOrder.items = [];

    renderPurchaseOrderItems();


    // Reset dates
    const today = new Date().toISOString().split("T")[0];

    purchaseOrder.orderDate = today;

    purchaseOrder.expectedDelivery = "";

    if (purchaseDOM.orderDate) {

        purchaseDOM.orderDate.value = today;

    }

    if (purchaseDOM.expectedDelivery) {

        purchaseDOM.expectedDelivery.value = "";

    }


    // Reset notes
    purchaseOrder.notes = "";

    if (purchaseDOM.notes) {

        purchaseDOM.notes.value = "";

    }


    // Reset additional costs to zero
    purchaseOrder.additionalCosts = 0;

    if (purchaseDOM.additionalCosts) {

        purchaseDOM.additionalCosts.value = 0;

    }


    // Reset subtotal, discounts, and grand total to zero
    purchaseOrder.subtotal = 0;

    purchaseOrder.discounts = 0;

    purchaseOrder.grandTotal = 0;

    purchaseOrder.status = "draft";

    updatePurchaseOrderSummary();


    console.log("PURCHASE ORDER RESET:", purchaseOrder);

}




async function savePurchaseOrder(status, button = null) {

    // Prevent duplicate submissions while a request is in progress

    if (isSaving) {

        return;

    }

    capturePurchaseOrderDetails();

    purchaseOrder.status = status;


    if (!validatePurchaseOrder()) {

        return;

    }


    calculatePurchaseOrderTotals();

    isSaving = true;

    // Disable the save button to prevent double-clicking

    if (button) {

        button.disabled = true;

    }

    try {

        const endpoint = isEditMode ? `/purchases/${editingPurchaseId}` : "/purchases";
        const method = isEditMode ? "PUT" : "POST";

        const result = await apiRequest(endpoint, {

            method: method,

            body: JSON.stringify(purchaseOrder)

        });


        const wasSubmittedForApproval = status === "pending-approval";
        showMessage(wasSubmittedForApproval
            ? "Purchase order submitted for approval successfully."
            : (result.message || "Purchase order saved as draft successfully."));


        console.log("SAVED PURCHASE ORDER:", result);


        // Reset form and edit mode only after the backend confirms successful saving
        resetPurchaseOrder();

        if (isEditMode) {

            isEditMode = false;

            editingPurchaseId = null;

        }

        if (wasSubmittedForApproval) {
            purchaseState.pagination = { page: 1 };
            window.location.hash = "purchase-orders";
        }

    } catch (error) {

        showMessage(
            error.message || "Unable to save purchase order."
        );

    } finally {
        isSaving = false;

        // Re-enable the save button whether successful or unsuccessful
        if (button) {
            button.disabled = false;
        }
    }

}




function printPurchaseOrder() {

    window.print();

}

function registerPurchaseOrderButtons() {

    const detailEditButton = document.querySelector(
        '#purchase-order-details [data-action="edit-po"]'
    );

    if (detailEditButton) {
        detailEditButton.addEventListener("click", event => {
            event.preventDefault();
            if (purchaseState.currentPurchaseId) {
                editPurchaseOrder(purchaseState.currentPurchaseId);
            }
        });
    }

    getElements('[data-action="save-draft"]').forEach(button => {

        button.addEventListener("click", () => {

            savePurchaseOrder("draft", button);

        });

    });

    getElements('[data-action="submit-for-approval"]').forEach(button => {

        button.addEventListener("click", () => {

            savePurchaseOrder("pending-approval", button);

        });

    });


    getElements('[data-action="confirm-approve"]').forEach(button => {

        button.addEventListener("click", () => {

            approvePurchaseOrder();

        });

    });

    getElements('[data-action="confirm-cancel"]').forEach(button => {

        button.addEventListener("click", () => {

            cancelPurchaseOrder();

        });

    });

    getElements('[data-action="print-po"]').forEach(button => {

        button.addEventListener("click", () => {

            printPurchaseOrder();

        });

    });

}



function readFiltersFromHTML(view) {

    const filters = purchaseState.filters || {};

    const searchInput = document.querySelector(
        `[data-field="filters.${view}.search"]`
    );

    const fromInput = document.querySelector(
        `[data-field="filters.${view}.from"]`
    );

    const toInput = document.querySelector(
        `[data-field="filters.${view}.to"]`
    );

    const supplierSelect = document.querySelector(
        `[data-field="filters.${view}.supplierId"]`
    );

    const statusSelect = document.querySelector(
        `[data-field="filters.${view}.status"]`
    );

    const paymentStatusSelect = document.querySelector(
        `[data-field="filters.${view}.paymentStatus"]`
    );

    if (searchInput) filters.search = searchInput.value.trim();

    if (fromInput) filters.from = fromInput.value;

    if (toInput) filters.to = toInput.value;

    if (supplierSelect) filters.supplierId = supplierSelect.value;

    if (statusSelect) filters.status = statusSelect.value;

    if (paymentStatusSelect) filters.paymentStatus = paymentStatusSelect.value;

    purchaseState.filters = filters;

    return filters;

}



async function loadPurchaseOrders(view) {

    const sectionId = view === "history"
        ? "purchase-history"
        : "purchase-orders";

    const section = document.getElementById(sectionId);

    if (!section) {
        return;
    }

    const filters = readFiltersFromHTML(view);

    const pageSizeSelect = section.querySelector(
        '[data-field="pagination.pageSize"]'
    );

    const pageSize = pageSizeSelect
        ? parseInt(pageSizeSelect.value, 10) || 10
        : 10;

    const queryParams = new URLSearchParams();

    if (filters.search) queryParams.append("search", filters.search);
    if (filters.status) queryParams.append("status", filters.status);
    if (filters.from) queryParams.append("from", filters.from);
    if (filters.to) queryParams.append("to", filters.to);
    if (filters.supplierId) {
        queryParams.append("supplierId", filters.supplierId);
    }
    if (filters.paymentStatus) {
        queryParams.append("paymentStatus", filters.paymentStatus);
    }

    queryParams.append("page", purchaseState.pagination?.page || 1);
    queryParams.append("pageSize", pageSize);

    try {

        const data = await apiRequest(
            `/purchases?${queryParams.toString()}`
        );

        purchaseState.purchases = data.purchases || [];

        purchaseState.pagination = data.pagination || {
            total: 0,
            page: 1,
            pageSize: pageSize,
            pages: 0,
            from: 0,
            to: 0
        };

        renderPurchaseOrders(view);

    } catch (error) {

        console.error("Failed to load purchase orders:", error);

        showMessage(
            error.message || "Unable to load purchase orders."
        );

    }

}



function renderPurchaseOrders(view) {

    const sectionId = view === "history"
        ? "purchase-history"
        : "purchase-orders";

    const listSelector = view === "history"
        ? 'purchaseHistory'
        : 'purchaseOrders';

    const section = document.getElementById(sectionId);

    if (!section) {
        console.error(`Purchase section not found: #${sectionId}`);
        return;
    }

    // Locate table elements using view-specific selectors
    const tbody = section.querySelector(
        `[data-list="${listSelector}"]`
    );

    const template = section.querySelector(
        `template[data-template="${listSelector}"]`
    );

    // Validate required HTML elements
    if (!tbody) {
        console.error(
            `Purchase table body not found in #${sectionId}. Check data-list="${listSelector}".`
        );
        return;
    }

    if (!template) {
        console.error(
            `Purchase row template not found in #${sectionId}. Check data-template="${listSelector}".`
        );
        return;
    }

    const purchases = purchaseState.purchases || [];

    const pagination = purchaseState.pagination || {
        total: 0,
        page: 1,
        pageSize: 10,
        pages: 0,
        from: 0,
        to: 0
    };

    // Clear existing rows except empty state rows
    tbody.querySelectorAll("tr:not([data-state])").forEach(row => {
        row.remove();
    });

    const emptyState = tbody.querySelector(
        '[data-state="empty"]'
    );

    // Show empty state when there are no purchases
    if (purchases.length === 0) {

        if (emptyState) {
            emptyState.hidden = false;
        }

        updatePaginationUI(section, pagination);
        return;
    }

    if (emptyState) {
        emptyState.hidden = true;
    }

    // Render purchase orders
    purchases.forEach(po => {

        const row = template.content.firstElementChild.cloneNode(true);

        row.dataset.id = po.id;

        // PO Number
        const numberLink = row.querySelector(
            'a[data-bind="po.number"]'
        );

        if (numberLink) {

            numberLink.textContent = po.number || "?";

            numberLink.addEventListener("click", event => {

                event.preventDefault();

                purchaseState.currentPurchaseId = po.id;

                window.location.hash = "purchase-order-details";

            });
        }

        // Supplier name
        const supplierEl = row.querySelector(
            '[data-bind="po.supplierName"]'
        );

        if (supplierEl) {
            supplierEl.textContent = po.supplierName || "?";
        }

        // Order date
        const orderDateEl = row.querySelector(
            '[data-bind="po.orderDate"]'
        );

        if (orderDateEl) {

            const rawDate = po.orderDate || "";

            orderDateEl.textContent = rawDate
                ? rawDate.split("T")[0]
                : "?";
        }

        // Expected delivery (only in purchase-orders view)
        const expectedDeliveryEl = row.querySelector(
            '[data-bind="po.expectedDelivery"]'
        );

        if (expectedDeliveryEl) {

            expectedDeliveryEl.textContent =
                formatDateDDMMYYYY(po.expectedDelivery) || "?";
        }

        // Total amount
        const totalEl = row.querySelector(
            '[data-bind="po.total"]'
        );

        if (totalEl) {

            totalEl.textContent = new Intl.NumberFormat("en-KE")
                .format(Number(po.total) || 0);
        }

        // Amount paid (only in purchase-orders view)
        const amountPaidEl = row.querySelector(
            '[data-bind="po.amountPaid"]'
        );

        if (amountPaidEl) {

            amountPaidEl.textContent =
                formatCurrency(po.amountPaid || 0);
        }

        // Outstanding balance (only in purchase-orders view)
        const outstandingEl = row.querySelector(
            '[data-bind="po.outstanding"]'
        );

        if (outstandingEl) {

            outstandingEl.textContent =
                formatCurrency(po.outstanding || 0);
        }

        /**
         * Map backend payment_status to badge class and display text
         * @param {string} status - Payment status from backend
         * @returns {{text: string, badgeClass: string}}
         */
        const mapPaymentStatus = (status) => {
            if (!status) return { text: '—', badgeClass: 'badge--unpaid' };
            const s = String(status).toLowerCase();
            if (s === 'paid') return { text: 'Paid', badgeClass: 'badge--paid' };
            if (s === 'partially paid') return { text: 'Partially Paid', badgeClass: 'badge--partially-paid' };
            if (s === 'unpaid') return { text: 'Unpaid', badgeClass: 'badge--unpaid' };
            return { text: status, badgeClass: 'badge--unpaid' };
        };

        const paymentStatusEl = row.querySelector(
            '[data-bind="po.paymentStatus"]'
        );

        if (paymentStatusEl) {
          
            const paymentStatus = po.payment_status || po.paymentStatus;
            const mapped = mapPaymentStatus(paymentStatus);
            paymentStatusEl.textContent = mapped.text;
            paymentStatusEl.className = `badge ${mapped.badgeClass}`;
        }

        const statusEl = row.querySelector(
            '[data-bind="po.status"]'
        );

        if (statusEl) {

            const statusValue = String(
                po.status || ""
            ).toLowerCase();

            statusEl.textContent = po.status || "?";

            statusEl.className = `badge badge--${statusValue}`;
        }


        const viewBtn = row.querySelector(
            '[data-action="view-po"]'
        );

        if (viewBtn) {

            viewBtn.addEventListener("click", event => {

                event.preventDefault();

                purchaseState.currentPurchaseId = po.id;

                window.location.hash = "purchase-order-details";

            });
        }
        const payBtn = row.querySelector('[data-action="open-supplier-payment"]');

if (payBtn) {
    payBtn.addEventListener("click", event => {
        event.preventDefault();
        purchaseState.currentPurchaseId = po.id;
    });
}


        const editBtn = row.querySelector(
            '[data-action="edit-po"]'
        );

        if (editBtn) {
            editBtn.hidden = String(po.status || "")
                .trim()
                .toLowerCase() !== "draft";

            editBtn.addEventListener("click", event => {

                event.preventDefault();

                editPurchaseOrder(po.id);

            });
        }

        tbody.appendChild(row);

    });

    updatePaginationUI(section, pagination);

}


// =====================================================
// 12. UPDATE PAGINATION UI
// =====================================================

function updatePaginationUI(section, pagination) {

    if (!section) {
        console.error("Pagination section not found.");
        return;
    }

    const info = section.querySelector(
        '[data-bind="pagination.from"]'
    );

    const toEl = section.querySelector(
        '[data-bind="pagination.to"]'
    );

    const totalEl = section.querySelector(
        '[data-bind="pagination.total"]'
    );

    const pageEl = section.querySelector(
        '[data-bind="pagination.page"]'
    );

    const pagesEl = section.querySelector(
        '[data-bind="pagination.pages"]'
    );

    const prevBtn = section.querySelector(
        '[data-action="page-prev"]'
    );

    const nextBtn = section.querySelector(
        '[data-action="page-next"]'
    );

    if (info) {
        info.textContent = pagination.from || 0;
    }

    if (toEl) {
        toEl.textContent = pagination.to || 0;
    }

    if (totalEl) {
        totalEl.textContent = pagination.total || 0;
    }

    if (pageEl) {
        pageEl.textContent = pagination.page || 1;
    }

    if (pagesEl) {
        pagesEl.textContent = pagination.pages || 1;
    }

    if (prevBtn) {
        prevBtn.disabled = !(
            pagination.page && pagination.page > 1
        );
    }

    if (nextBtn) {
        nextBtn.disabled = !(
            pagination.page &&
            pagination.pages &&
            pagination.page < pagination.pages
        );
    }

}


function loadLoggedInUser() {

    const savedUser = localStorage.getItem("pos_user");

    if (!savedUser) {
        console.warn("No logged-in user found");

        document.getElementById("userName").textContent =
            "Unknown User";

        document.getElementById("userRole").textContent =
            "User";

        document.getElementById("terminalName").textContent =
            "Unknown Terminal";

        return;
    }

    const user = JSON.parse(savedUser);

    document.getElementById("userName").textContent =
        user.name || "Unknown User";

    document.getElementById("userRole").textContent =
        user.role || "User";

    document.getElementById("terminalName").textContent =
        user.terminal || "Unknown Terminal";

    const initials = (user.name || "User")
        .split(" ")
        .map(word => word.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

    document.getElementById("userAvatar").textContent =
        initials;

}




function registerPurchaseOrderListFilters() {

    const ordersSection = document.getElementById("purchase-orders");

    if (!ordersSection) {
        return;
    }

    // Wire up filters and pagination for a given section/view
    function wireSection(section, view) {

        if (!section) return;

        // Search input (debounced)

        const searchInput = section.querySelector(
            `[data-field="filters.${view}.search"]`
        );

        if (searchInput) {

            let searchTimeout;

            searchInput.addEventListener("input", () => {

                clearTimeout(searchTimeout);

                searchTimeout = setTimeout(() => {

                    purchaseState.pagination = { page: 1 };

                    loadPurchaseOrders(view);

                }, 300);

            });

        }

        // Filter selects

        ["from", "to", "supplierId", "status", "paymentStatus"].forEach(field => {

            const el = section.querySelector(
                `[data-field="filters.${view}.${field}"]`
            );

            if (el) {

                el.addEventListener("change", () => {

                    purchaseState.pagination = { page: 1 };

                    loadPurchaseOrders(view);

                });

            }

        });

        // Page size

        const pageSizeSelect = section.querySelector(
            '[data-field="pagination.pageSize"]'
        );

        if (pageSizeSelect) {

            pageSizeSelect.addEventListener("change", () => {

                purchaseState.pagination = { page: 1 };

                loadPurchaseOrders(view);

            });

        }

        // Pagination buttons

        const prevBtn = section.querySelector(
            '[data-action="page-prev"]'
        );

        const nextBtn = section.querySelector(
            '[data-action="page-next"]'
        );

        if (prevBtn) {

            prevBtn.addEventListener("click", () => {

                const pagination = purchaseState.pagination || {};

                if (pagination.page > 1) {

                    purchaseState.pagination = {
                        page: pagination.page - 1
                    };

                    loadPurchaseOrders(view);

                }

            });

        }

        if (nextBtn) {

            nextBtn.addEventListener("click", () => {

                const pagination = purchaseState.pagination || {};

                if (pagination.page < pagination.pages) {

                    purchaseState.pagination = {
                        page: pagination.page + 1
                    };

                    loadPurchaseOrders(view);

                }

            });

        }

    }

    // Wire up both purchase-orders and purchase-history sections
    wireSection(ordersSection, "orders");

    const historySection = document.getElementById("purchase-history");
    wireSection(historySection, "history");

}



function populateSupplierFilter() {

    const ordersSelect = document.querySelector(
        '[data-field="filters.orders.supplierId"]'
    );

    const historySelect = document.querySelector(
        '[data-field="filters.history.supplierId"]'
    );

    if (!ordersSelect && !historySelect) {
        return;
    }

    const suppliers = suppliersData || [];

    function populateSelect(select) {
        if (!select) return;

        // Keep the "All suppliers" option
        const allOption = select.querySelector('option[value=""]');

        select.innerHTML = "";

        if (allOption) {
            select.appendChild(allOption);
        }

        suppliers.forEach(supplier => {

            const option = document.createElement("option");

            option.value = supplier.id;

            option.textContent = supplier.name;

            select.appendChild(option);

        });
    }

    populateSelect(ordersSelect);
    populateSelect(historySelect);

}


let isApproving = false;
let isCancelling = false;
async function approvePurchaseOrder() {
    if (isApproving) return;
    const purchaseId = purchaseState.currentPurchaseId;
    if (!purchaseId) { showMessage('No purchase order selected.'); return; }
    isApproving = true;
    try {
        const result = await apiRequest('/purchases/' + purchaseId + '/approve', { method: 'PUT' });
        showMessage(result.message || 'Purchase order approved successfully.');
        const modal = document.getElementById('modal-approve');
        if (modal && typeof modal.hidePopover === 'function') {
            modal.hidePopover();
        }
        await openPurchaseDetails(purchaseId);
    } catch (error) {
        showMessage(error.message || 'Unable to approve purchase order.');
    } finally {
        isApproving = false;
    }
}

async function cancelPurchaseOrder() {

    if (isCancelling) return;

    const purchaseId = purchaseState.currentPurchaseId;

    if (!purchaseId) {
        showMessage('No purchase order selected.');
        return;
    }

    const reasonEl = document.getElementById('cancel-reason');
    const reason = reasonEl ? reasonEl.value.trim() : '';

    if (!reason) {
        showMessage('Please enter a cancellation reason.');
        return;
    }

    isCancelling = true;

    try {

        const result = await apiRequest('/purchases/' + purchaseId + '/cancel', {
            method: 'PUT',
            body: JSON.stringify({ reason: reason })
        });

        showMessage(result.message || 'Purchase order cancelled successfully.');

        const modal = document.getElementById('modal-cancel-order');
        if (modal && typeof modal.hidePopover === 'function') {
            modal.hidePopover();
        }

        if (reasonEl) reasonEl.value = '';

        await openPurchaseDetails(purchaseId);

    } catch (error) {

        showMessage(error.message || 'Unable to cancel purchase order.');

    } finally {
        isCancelling = false;
    }

}
