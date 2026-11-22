

async function loadPurchaseView() {

    const hash = window.location.hash.replace("#", "") || "purchase-dashboard";

    try {

        if (hash === "purchase-dashboard") {

            await Promise.all([

                loadPurchaseDashboard(),

                loadPurchaseOrders("orders")

            ]);

        } else if (hash === "purchase-orders") {

            readFiltersFromHTML("orders");

            await loadPurchaseOrders("orders");


           

            populateSupplierFilter();

        } else if (hash === "create-purchase-order") {

        

            await searchPurchaseProducts();

        } else if (hash === "purchase-order-details") {

            if (purchaseState.currentPurchaseId) {

                await openPurchaseDetails(
                    purchaseState.currentPurchaseId
                );

            }

        } else if (hash === "goods-receiving") {

            await initializeReceiving();

        } else if (hash === "supplier-payments") {

            await initializeSupplierPayments();

        } else if (hash === "purchase-history") {

            readFiltersFromHTML("history");

            await loadPurchaseOrders("history");

            await loadSuppliers();

            populateSupplierFilter();
        } else if (hash === "purchase-reports") {

            await loadPurchaseReports();

        }

    } catch (error) {

        console.error("Unable to load purchase view:", error);

    }

}




window.addEventListener("hashchange", loadPurchaseView);
