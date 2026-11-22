


async function searchPurchaseProducts(search = "") {

    try {

        // Fetch products once
        if (!purchaseState.productsLoaded) {

            const response = await apiRequest("/purchase-products");

            purchaseState.allProducts = Array.isArray(response)
                ? response
                : response.products || [];

            purchaseState.productsLoaded = true;

        }

        // Filter products
        const query = String(search).trim().toLowerCase();

        purchaseState.products = purchaseState.allProducts.filter(product => {

            const name = (product.name || "").toLowerCase();
            const barcode = (product.barcode || "").toLowerCase();
            const category = (product.category || "").toLowerCase();

            return (
                name.includes(query) ||
                barcode.includes(query) ||
                category.includes(query)
            );

        });

        // Display matching products
        renderProductPicker();

        console.log("PURCHASE PRODUCTS:", purchaseState.products);

        return purchaseState.products;

    } catch (error) {

        console.error("Failed to load purchase products:", error);

        showMessage("Unable to load products.");

        throw error;

    }

}




function renderProductPicker() {

    const tbody = document.querySelector(
        '[data-list="productPicker.results"]'
    );

    const template = document.querySelector(
        'template[data-template="productPicker.results"]'
    );

    if (!tbody || !template) {

        console.error("Product picker table or template not found.");

        return;

    }

    // Remove previously displayed products
    tbody.querySelectorAll("tr:not([data-state])").forEach(row => {
        row.remove();
    });

    const emptyState = tbody.querySelector('[data-state="empty"]');

    // Show empty state when no products match
    if (purchaseState.products.length === 0) {

        if (emptyState) emptyState.hidden = false;

        return;

    }

    if (emptyState) emptyState.hidden = true;

    // Display matching products
    purchaseState.products.forEach(product => {

        const row = template.content.firstElementChild.cloneNode(true);

        row.dataset.productId = product.id;

        row.querySelector('[data-bind="product.barcode"]').textContent =
            product.barcode || "-";

        row.querySelector('[data-bind="product.name"]').textContent =
            product.name || "-";

        row.querySelector('[data-bind="product.category"]').textContent =
            product.category || "-";

        const lastCost = product.lastCost ?? product.last_cost;

        row.querySelector('[data-bind="product.lastCost"]').textContent =
            lastCost ?? "—";

        tbody.appendChild(row);

    });

}




function addPurchaseProduct(product) {

    // Prevent duplicate products
    const existingItem = purchaseOrder.items.find(
        item => Number(item.productId) === Number(product.id)
    );

    if (existingItem) {

        showMessage("This product has already been added.");

        return;

    }

    // Get last purchase cost
    const lastCost = product.lastCost ?? product.last_cost;

    // Use last cost if available
    // Otherwise leave purchase price blank
    const unitPrice = Number(lastCost) > 0
        ? Number(lastCost)
        : "";

    // Create purchase item
    const newItem = {

        productId: product.id,

        name: product.name,

        barcode: product.barcode || "",

        category: product.category || "-",

        quantity: 1,

        unitPrice: unitPrice,

        discount: 0,

        subtotal: Number(unitPrice) || 0

    };

    // Add product to purchase order
    purchaseOrder.items.push(newItem);

    // Display selected products
    renderPurchaseOrderItems();

    // Update purchase order totals
    calculatePurchaseOrderTotals();

    showMessage(`${product.name} added successfully.`);

}




function renderPurchaseOrderItems() {

    const tbody = document.querySelector(
        '[data-list="po.items"]'
    );

    const template = document.querySelector(
        'template[data-template="po.items"]'
    );

    if (!tbody || !template) {

        console.error("Purchase order items table or template not found.");

        return;

    }

    // Remove previously rendered products
    tbody.querySelectorAll("tr:not([data-state])").forEach(row => {
        row.remove();
    });

    const emptyState = tbody.querySelector('[data-state="empty"]');

    // Handle empty purchase order
    if (purchaseOrder.items.length === 0) {

        if (emptyState) emptyState.hidden = false;

        return;

    }

    if (emptyState) emptyState.hidden = true;

    // Render selected products
    purchaseOrder.items.forEach(item => {

        const row = template.content.firstElementChild.cloneNode(true);

        row.dataset.productId = item.productId;

        row.querySelector('[data-bind="item.name"]').textContent =
            item.name;

        row.querySelector('[data-bind="item.barcode"]').textContent =
            item.barcode || "-";

        row.querySelector('[data-bind="item.category"]').textContent =
            item.category || "-";

        const quantityInput = row.querySelector(
            '[data-field="item.quantity"]'
        );

        const priceInput = row.querySelector(
            '[data-field="item.unitPrice"]'
        );

        const discountInput = row.querySelector(
            '[data-field="item.discount"]'
        );

        if (quantityInput) {
            quantityInput.value = item.quantity;
        }

        if (priceInput) {
            priceInput.value = item.unitPrice;
        }

        if (discountInput) {
            discountInput.value = item.discount;
        }

        const subtotalElement = row.querySelector(
            '[data-bind="item.subtotal"]'
        );

        if (subtotalElement) {

            subtotalElement.textContent =
                formatCurrency(item.subtotal);

        }

        tbody.appendChild(row);

    });

}




function registerProductPickerEvents() {

    const pickerList = document.querySelector(
        '[data-list="productPicker.results"]'
    );

    const itemsList = document.querySelector(
        '[data-list="po.items"]'
    );

    const productSearchInput = document.querySelector(
        '[data-field="productPicker.query"]'
    );


    

    if (productSearchInput) {

        productSearchInput.addEventListener("input", function () {

            searchPurchaseProducts(this.value);

        });

    }


    

    if (pickerList) {

        pickerList.addEventListener("click", function(event) {

            const button = event.target.closest(
                '[data-action="pick-product"]'
            );

            if (!button) return;

            const row = button.closest("tr");

            if (!row) return;

            const productId = Number(row.dataset.productId);

            const product = purchaseState.allProducts.find(
                item => Number(item.id) === productId
            );

            if (!product) {

                showMessage("Product could not be found.");

                return;

            }

            addPurchaseProduct(product);

        });

    }


    

    if (itemsList) {

        itemsList.addEventListener("input", function(event) {

            const row = event.target.closest("tr");

            if (!row) return;

            const productId = Number(row.dataset.productId);

            const item = purchaseOrder.items.find(
                product => Number(product.productId) === productId
            );

            if (!item) return;


            // Update quantity
            if (event.target.matches('[data-field="item.quantity"]')) {

                item.quantity = Number(event.target.value) || 0;

            }
            // Update purchase price
            if (event.target.matches('[data-field="item.unitPrice"]')) {

                item.unitPrice = event.target.value === ""

                    ? ""

                    : Number(event.target.value);

            }


            // Update discount
            if (event.target.matches('[data-field="item.discount"]')) {

                item.discount = Number(event.target.value) || 0;

            }


            // Calculate product subtotal
            const quantity = Number(item.quantity) || 0;

            const unitPrice = Number(item.unitPrice) || 0;

            const discount = Number(item.discount) || 0;

            item.subtotal = (quantity * unitPrice) - discount;


            // Update displayed subtotal
            const subtotalElement = row.querySelector(
                '[data-bind="item.subtotal"]'
            );

            if (subtotalElement) {

                subtotalElement.textContent =
                    formatCurrency(item.subtotal);

            }


            // Update purchase order totals
            calculatePurchaseOrderTotals();

        });


        

        itemsList.addEventListener("click", function(event) {

            const button = event.target.closest(
                '[data-action="remove-item"]'
            );

            if (!button) return;

            const row = button.closest("tr");

            if (!row) return;

            const productId = Number(row.dataset.productId);

            // Remove selected product
            purchaseOrder.items = purchaseOrder.items.filter(
                item => Number(item.productId) !== productId
            );

            // Refresh selected products
            renderPurchaseOrderItems();

            // Recalculate totals
            calculatePurchaseOrderTotals();

            showMessage("Product removed successfully.");

        });

    }

    

    const togglePickerBtn = document.querySelector(
        '[data-action="toggle-product-picker"]'
    );

    if (togglePickerBtn && productSearchInput && pickerList) {

        const resultsTable = pickerList.closest("table");

        togglePickerBtn.addEventListener("click", () => {

            const show = resultsTable ? resultsTable.hidden : pickerList.hidden;

            productSearchInput.closest("label").hidden = !show;

            if (resultsTable) {
                resultsTable.hidden = !show;
            } else {
                pickerList.hidden = !show;
            }

        });

    }

}
