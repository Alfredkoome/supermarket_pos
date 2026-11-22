

const API_BASE = window.POS_API_BASE;




const purchaseState = {

    purchases: [],

    suppliers: [],

    products: [],

    allProducts: [],

    productsLoaded: false,

};

let suppliersData = [];




const purchaseDOM = {

    supplierSelect: document.getElementById("po-supplier"),

    poNumber: document.getElementById("po-number"),

    createdBy: document.getElementById("po-created-by"),

    orderDate: document.getElementById("po-order-date"),

    expectedDelivery: document.getElementById("po-expected-date"),

    notes: document.getElementById("po-notes"),

    additionalCosts: document.getElementById("po-additional"),

    itemsTable: document.querySelectorAll(
        '[data-options="suppliers"], [data-options="activeSuppliers"]'
    ),

    subtotal: document.querySelector('[data-bind="po.subtotal"]'),

    discounts: document.querySelector('[data-bind="po.discounts"]'),

    grandTotal: document.getElementById("purchaseGrandTotal"),

    supplierName: document.getElementById("po-sup-name"),

    supplierContact: document.getElementById("po-sup-contact"),

    supplierPhone: document.getElementById("po-sup-phone"),

    supplierEmail: document.getElementById("po-sup-email"),

    supplierAddress: document.getElementById("po-sup-address"),

};






const purchaseOrder = {

    supplierId: "",

    supplier: {

        name: "",

        contactPerson: "",

        phone: "",

        email: "",

        address: "",

        outstandingBalance: 0

    },

    number: "",

    createdBy: "",

    orderDate: "",

    expectedDelivery: "",

    notes: "",

    items: [],

    subtotal: 0,

    discounts: 0,

    additionalCosts: 0,

    grandTotal: 0,

    status: "draft"

};