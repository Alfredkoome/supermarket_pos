

async function loadSuppliers() {

    try {

        const responseData = await apiRequest("/suppliers");

        suppliersData = Array.isArray(responseData)
            ? responseData
            : responseData.suppliers || [];

        purchaseDOM.supplierSelect.innerHTML = `
            <option value="">Select a supplier...</option>
        `;

        suppliersData.forEach(supplier => {

            const option = document.createElement("option");

            option.value = supplier.id;

            option.textContent = supplier.name;

            purchaseDOM.supplierSelect.appendChild(option);

        });

        console.log("SUPPLIERS LOADED:", suppliersData);

    } catch (error) {

        console.error("Failed to load suppliers:", error);

        showMessage("Unable to load suppliers.");

    }

}




function registerSupplierEvents() {

    purchaseDOM.supplierSelect.addEventListener("change", () => {

        const supplierId = purchaseDOM.supplierSelect.value;

        purchaseOrder.supplierId = supplierId;

        const supplier = suppliersData.find(
            item => item.id == supplierId
        );

        if (!supplier) {
            return;
        }

        purchaseOrder.supplier = {

            name: supplier.name,

            contactPerson: supplier.contact_person,

            phone: supplier.phone,

            email: supplier.email,

            address: supplier.address,

            outstandingBalance: 0

        };

        purchaseDOM.supplierName.value = supplier.name;

        purchaseDOM.supplierContact.value =
            supplier.contact_person || "";

        purchaseDOM.supplierPhone.value = supplier.phone;

        purchaseDOM.supplierEmail.value =
            supplier.email || "";

        purchaseDOM.supplierAddress.value =
            supplier.address || "";

    });

}