(function (global) {
  "use strict";

  var NombaPayDropin = {
    _config: null,
    _modalElement: null,

    setup: function (config) {
      if (!config.backendUrl) throw new Error("NombaPayDropin: backendUrl is required");
      if (!config.amount) throw new Error("NombaPayDropin: amount is required");
      if (!config.customerEmail) throw new Error("NombaPayDropin: customerEmail is required");

      this._config = config;
      return this;
    },

    open: function () {
      var self = this;
      if (!self._config) return console.error("NombaPayDropin: Run .setup() first.");

      // Dynamically calls the custom backend proxy
      fetch(self._config.backendUrl + "/api/checkout/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: self._config.amount,
          customerEmail: self._config.customerEmail,
          orderReference: self._config.orderReference,
          callbackUrl: self._config.callbackUrl
        })
      })
      .then(function (res) {
        if (!res.ok) return res.json().then(function(err) { throw err; });
        return res.json();
      })
      .then(function (data) {
        if (data.checkoutLink) {
          self._injectModal(data.checkoutLink, data.orderReference);
        } else {
          throw new Error("Invalid backend token response structure.");
        }
      })
      .catch(function (err) {
        console.error("NombaPayDropin SDK Error:", err);
        if (typeof self._config.onError === "function") {
          self._config.onError(err);
        }
      });
    },

    close: function () {
      if (this._modalElement && this._modalElement.parentNode) {
        this._modalElement.parentNode.removeChild(this._modalElement);
      }
      this._modalElement = null;
      document.removeEventListener("keydown", this._escapeBind);
      if (typeof this._config.onClose === "function") this._config.onClose();
    },

    _injectModal: function (url, reference) {
      var self = this;
      
      var modal = document.createElement("div");
      modal.style = "fixed;top:0;left:0;width:100%;height:100%;background:rgba(20,24,28,0.65);backdrop-filter:blur(4px);z-index:999999;display:flex;align-items:center;justify-content:center;padding:20px;position:fixed;";
      
      var frameContainer = document.createElement("div");
      frameContainer.style = "position:relative;width:100%;max-width:450px;height:90vh;max-height:650px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 24px 38px 3px rgba(0,0,0,0.14);";

      var closeBtn = document.createElement("button");
      closeBtn.innerHTML = "&times;";
      closeBtn.style = "position:absolute;top:10px;right:16px;background:none;border:none;font-size:30px;cursor:pointer;color:#9ca3af;z-index:100;";
      closeBtn.onclick = function () { self.close(); };

      var iframe = document.createElement("iframe");
      iframe.src = url;
      iframe.style = "width:100%;height:100%;border:none;";

      frameContainer.appendChild(closeBtn);
      frameContainer.appendChild(iframe);
      modal.appendChild(frameContainer);
      document.body.appendChild(modal);
      
      self._modalElement = modal;

      // Close on escape key
      self._escapeBind = function(e) { if(e.key === "Escape") self.close(); };
      document.addEventListener("keydown", self._escapeBind);
    }
  };

  global.NombaPayDropin = NombaPayDropin;
})(typeof window !== "undefined" ? window : this);
