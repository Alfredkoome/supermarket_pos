

function initializePurchaseManagement() {

    console.log("Purchase Management initialized.");


    initializePurchaseOrder();

  
    registerPurchaseOrderEvents();


    registerPurchaseOrderButtons();

    registerSupplierEvents();
    registerProductPickerEvents();

    registerPurchaseOrderListFilters();
   
    registerReceivingSelectorEvents();
   
    registerReceivingButtonEvents();
    
    registerPaymentEvents();
    registerPurchaseReportEvents();
    loadLoggedInUser();
    

}




document.addEventListener("DOMContentLoaded", async function () {

    try {

        
        initializePurchaseManagement();

   
        await loadPurchaseView();

    } catch (error) {

        console.error(
            "Purchase Management initialization failed:",
            error
        );

    }

});


let isEditMode = false;
let editingPurchaseId = null;
