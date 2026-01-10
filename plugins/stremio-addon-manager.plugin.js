/**
 * @name Stremio Addon Manager
 * @description Reorganize and rename your Stremio addons from the client.
 * @updateUrl https://raw.githubusercontent.com/Zcc09/stremio-addon-manager-plugin/refs/heads/main/stremio-addon-manager.plugin.js
 * @version 1.8.1
 * @author Zcc09
 */

(function () {
	"use strict";

	// --- METADATA ---
	const PLUGIN_NAME = "Stremio Addon Manager";
	const STREMIO_API_BASE = "https://api.strem.io/api/";
	const THEME_PURPLE = "#7b5bf5";
	const THEME_GREEN = "#22b365";

	// --- STATE ---
	let stremioAuthKey = "";
	let addons = [];
	let draggingElement = null;

	// --- CORE FUNCTIONS ---

	function getAuthKey() {
		try {
			const profile = JSON.parse(localStorage.getItem("profile"));
			if (profile && profile.auth && profile.auth.key) {
				return profile.auth.key;
			}
		} catch (e) {
			console.error(`${PLUGIN_NAME}: Could not retrieve auth key.`, e);
		}
		return null;
	}

	// --- UI CREATION & INJECTION ---

	function initUIManager() {
		const managerButton = document.createElement("button");
		managerButton.id = "addon-manager-button";
		managerButton.textContent = "Edit Addons";
		managerButton.style.display = "none";

		Object.assign(managerButton.style, {
			position: "fixed",
			bottom: "20px",
			right: "20px",
			zIndex: "10000",
			padding: "12px 20px",
			backgroundColor: THEME_GREEN,
			color: "white",
			border: "none",
			borderRadius: "8px",
			cursor: "pointer",
			fontSize: "16px",
			fontWeight: "bold",
			boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
			transition: "opacity 0.3s ease, transform 0.3s ease",
		});

		managerButton.onclick = openManagerModal;
		document.body.appendChild(managerButton);

		// Use hashchange event instead of polling - much more efficient
		const updateButtonVisibility = () => {
			const isOnAddonsPage = window.location.hash.startsWith("#/addons");
			managerButton.style.display = isOnAddonsPage ? "block" : "none";
		};

		window.addEventListener('hashchange', updateButtonVisibility);
		// Initial check
		updateButtonVisibility();
	}

	function openManagerModal() {
		stremioAuthKey = getAuthKey();
		if (!stremioAuthKey) {
			alert(
				"Could not access Stremio login information. Please ensure you are logged in."
			);
			return;
		}

		const existingModal = document.getElementById("addon-manager-modal");
		if (existingModal) {
			existingModal.style.display = "block";
			return;
		}

		const modal = document.createElement("div");
		modal.id = "addon-manager-modal";
		modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                     <h2>${PLUGIN_NAME}</h2>
                     <span class="close-button">&times;</span>
                </div>
                <div class="modal-body">
                    <div id="controls-section">
                        <button id="load-addons-button">Load/Refresh Addons</button>
                    </div>
                    <div id="addons-list-container"></div>
                </div>
                <div class="modal-footer">
                    <button id="sync-addons-button" style="display:none;">Sync to Stremio</button>
                </div>
            </div>
        `;
		document.body.appendChild(modal);
		addModalStyles();
		setupModalEventListeners();
		loadUserAddons();
	}

	function setupModalEventListeners() {
		const modal = document.getElementById("addon-manager-modal");
		modal.querySelector(".close-button").onclick = () =>
			(modal.style.display = "none");
		modal.querySelector("#load-addons-button").onclick = loadUserAddons;
		modal.querySelector("#sync-addons-button").onclick = syncUserAddons;
	}

	function renderAddonsList() {
		const container = document.getElementById("addons-list-container");
		const scrollPosition = container.scrollTop;
		container.innerHTML = "";
		const ul = document.createElement("ul");
		ul.id = "addons-list";
		ul.style.listStyle = "none";
		ul.style.padding = "0";

		addons.forEach((addon, index) => {
			const li = document.createElement("li");
			li.className = "addon-item";
			li.dataset.index = index;
			li.draggable = true;

			li.innerHTML = `
                <div class="addon-details">
                    <img src="${
											addon.manifest.logo ||
											"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIxIDE2VjhhMiAyIDAgMCAwLTEtMS43M2wtNy00YTIgMiAwIDAgMC0yIDBsLTcgNEEyIDIgMCAwIDAgMyA4djhhMiAyIDAgMCAwIDEgMS43M2w3IDRhMiAyIDAgMCAwIDIgMGw3LTRBMiAyIDAgMCAwIDIxIDE2eiI+PC9wYXRoPjxwb2x5bGluZSBwb2ludHM9IjMuMjcgNi45NiAxMiAxMi4wMSAyMC43MyA2Ljk2Ij48L3BvbHlsaW5lPjxsaW5lIHgxPSIxMiIgeTE9IjIyLjA4IiB4Mj0iMTIiIHkyPSIxMiI+PC9saW5lPjwvc3ZnPg=="
										}" class="addon-logo">
                    <span>${addon.manifest.name}</span>
                </div>
                <div class="addon-actions">
                    <button class="edit-button am-button">Edit</button>
                    <button class="delete-button am-button" ${
											addon.flags && addon.flags.protected ? "disabled" : ""
										}>Delete</button>
                </div>
            `;
			ul.appendChild(li);
		});

		container.appendChild(ul);
		container.scrollTop = scrollPosition;
		document.getElementById("sync-addons-button").style.display = "block";
		addDragAndDropEventListeners();
		addEditDeleteEventListeners();
	}

	// --- EVENT LISTENERS ---

	function addDragAndDropEventListeners() {
		const items = document.querySelectorAll(".addon-item");
		items.forEach((item) => {
			item.addEventListener("dragstart", handleDragStart);
			item.addEventListener("dragenter", handleDragEnter);
			item.addEventListener("dragleave", handleDragLeave);
			item.addEventListener("dragover", handleDragOver);
			item.addEventListener("drop", handleDrop);
			item.addEventListener("dragend", handleDragEnd);
		});
	}

	function addEditDeleteEventListeners() {
		document.querySelectorAll(".edit-button").forEach((button, index) => {
			button.onclick = () => openEditModal(index);
		});
		document.querySelectorAll(".delete-button").forEach((button, index) => {
			button.onclick = () => {
				addons.splice(index, 1);
				renderAddonsList();
			};
		});
	}

	// --- DRAG AND DROP HANDLERS ---

	function handleDragStart(e) {
		draggingElement = this;
		this.classList.add("dragging");
	}

	function handleDragEnter(e) {
		this.classList.add("drag-over");
	}

	function handleDragLeave(e) {
		this.classList.remove("drag-over");
	}

	function handleDragOver(e) {
		e.preventDefault();
	}

	function handleDrop(e) {
		e.stopPropagation();
		if (draggingElement !== this) {
			const fromIndex = parseInt(draggingElement.dataset.index);
			const toIndex = parseInt(this.dataset.index);
			const movedItem = addons.splice(fromIndex, 1)[0];
			addons.splice(toIndex, 0, movedItem);
			renderAddonsList();
		}
	}

	function handleDragEnd() {
		document.querySelectorAll(".addon-item").forEach((item) => {
			item.classList.remove("dragging");
			item.classList.remove("drag-over");
		});
	}

	// --- EDIT MODAL ---
	function openEditModal(index) {
		const addon = addons[index];
		const manifest = addon.manifest || {};
		const editModal = document.createElement("div");
		editModal.className = "modal";
		editModal.id = "edit-addon-modal";

		let catalogsHtml = "";
		if (manifest.catalogs && manifest.catalogs.length > 0) {
			catalogsHtml = manifest.catalogs
				.map(
					(catalog, catIndex) => `
                <div class="form-group">
                    <label>Catalog: ${catalog.name}</label>
                    <input type="text" data-cat-index="${catIndex}" value="${catalog.name}">
                </div>
            `
				)
				.join("");
		}

		editModal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Edit Addon</h3>
                    <span class="close-button">&times;</span>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Name</label>
                        <input type="text" id="edit-name" value="${
													manifest.name || ""
												}">
                    </div>
                     <div class="form-group">
                        <label>Description</label>
                        <textarea id="edit-description" rows="3">${
													manifest.description || ""
												}</textarea>
                    </div>
                    <details class="advanced-details">
                        <summary>Advanced</summary>
                        <div class="advanced-content">
                            <div class="form-group">
                                <label>Logo URL</label>
                                <input type="text" id="edit-logo" value="${
																	manifest.logo || ""
																}">
                            </div>
                            <div class="form-group">
                                <label>Background URL</label>
                                <input type="text" id="edit-background" value="${
																	manifest.background || ""
																}">
                            </div>
                            ${catalogsHtml}
                        </div>
                    </details>
                </div>
                <div class="modal-footer">
                    <button id="save-manifest-button" class="am-button">Save</button>
                </div>
            </div>
        `;
		document.body.appendChild(editModal);

		editModal.querySelector(".close-button").onclick = () => editModal.remove();
		editModal.querySelector("#save-manifest-button").onclick = () => {
			const newManifest = addons[index].manifest;
			newManifest.name = document.getElementById("edit-name").value;
			newManifest.description =
				document.getElementById("edit-description").value;
			newManifest.logo = document.getElementById("edit-logo").value;
			newManifest.background = document.getElementById("edit-background").value;

			if (newManifest.catalogs && newManifest.catalogs.length > 0) {
				document
					.querySelectorAll("#edit-addon-modal [data-cat-index]")
					.forEach((input) => {
						const catIndex = parseInt(input.dataset.catIndex);
						newManifest.catalogs[catIndex].name = input.value;
					});
			}

			renderAddonsList();
			editModal.remove();
		};
	}

	// --- API CALLS ---

	function loadUserAddons() {
		if (!stremioAuthKey) {
			alert("Authentication key not found. Please ensure you are logged in.");
			return;
		}

		const button = document.getElementById("load-addons-button");
		button.textContent = "Loading...";
		button.disabled = true;

		fetch(`${STREMIO_API_BASE}addonCollectionGet`, {
			method: "POST",
			body: JSON.stringify({
				type: "AddonCollectionGet",
				authKey: stremioAuthKey,
				update: true,
			}),
		})
			.then((resp) => resp.json())
			.then((data) => {
				if (data.result && data.result.addons) {
					addons = data.result.addons;
					renderAddonsList();
				} else {
					alert("Failed to fetch addons. Your session might be invalid.");
				}
			})
			.catch((error) => {
				console.error("Error fetching addons:", error);
				alert("An error occurred while fetching addons.");
			})
			.finally(() => {
				button.textContent = "Load/Refresh Addons";
				button.disabled = false;
			});
	}

	function syncUserAddons() {
		if (!stremioAuthKey) {
			alert("Authentication key not found. Cannot sync.");
			return;
		}

		const button = document.getElementById("sync-addons-button");
		button.textContent = "Syncing...";
		button.disabled = true;

		fetch(`${STREMIO_API_BASE}addonCollectionSet`, {
			method: "POST",
			body: JSON.stringify({
				type: "AddonCollectionSet",
				authKey: stremioAuthKey,
				addons: addons,
			}),
		})
			.then((resp) => resp.json())
			.then((data) => {
				if (data.result && data.result.success) {
					location.reload();
				} else {
					alert(
						"Sync failed: " +
							(data.result ? data.result.error : "Unknown error")
					);
				}
			})
			.catch((error) => {
				console.error("Error syncing addons:", error);
				alert("An error occurred while syncing addons.");
			})
			.finally(() => {
				button.textContent = "Sync to Stremio";
				button.disabled = false;
			});
	}

	// --- STYLES ---

	function addModalStyles() {
		const styleId = "addon-manager-styles";
		if (document.getElementById(styleId)) return;

		const style = document.createElement("style");
		style.id = styleId;
		style.textContent = `
            #addon-manager-modal, .modal {
                display: block; position: fixed; z-index: 10000; left: 0; top: 0;
                width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.7);
            }
            .modal-content {
                background-color: #1e1e1e; color: white; margin: 5vh auto; padding: 0;
                border-top: 4px solid ${THEME_PURPLE}; width: 90%; max-width: 600px;
                border-radius: 8px; max-height: 90vh; display: flex; flex-direction: column;
                box-shadow: 0 5px 25px rgba(0,0,0,0.5);
            }
            .modal-header, .modal-footer {
                flex-shrink: 0; padding: 20px 25px;
            }
            .modal-header {
                display: flex; justify-content: space-between; align-items: center;
                border-bottom: 1px solid #444;
            }
            .modal-footer {
                border-top: 1px solid #444; background-color: #2a2a2a;
                border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;
            }
            .modal-body {
                overflow-y: auto; padding: 10px 25px; flex-grow: 1;
            }
            .modal-header h2, .modal-header h3 {
                color: ${THEME_PURPLE}; margin: 0; padding: 0; border: none;
            }
            .close-button {
                color: #aaa; font-size: 28px; font-weight: bold; cursor: pointer;
            }
            .modal-content input, .modal-content textarea {
                width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box;
                background-color: #333; color: white; border: 1px solid #555; border-radius: 4px;
            }
            #load-addons-button, #sync-addons-button, .am-button {
                background-color: ${THEME_PURPLE}; color: white; padding: 10px 15px;
                border: none; cursor: pointer; border-radius: 5px; margin: 0;
                font-weight: bold; transition: background-color 0.2s;
            }
            #load-addons-button:hover, #sync-addons-button:hover, .am-button:hover {
                background-color: #6145b8;
            }
            .delete-button.am-button { background-color: #c62828; }
            .delete-button.am-button:hover { background-color: #b71c1c; }
            .addon-item {
                display: flex; justify-content: space-between; align-items: center; padding: 10px;
                margin: 5px 0; background-color: #2c2c2c; border: 2px solid transparent;
                border-radius: 5px; cursor: move; outline: none;
                transition: background-color 0.2s ease, border-color 0.2s ease;
            }
            .addon-item.dragging { opacity: 0.4; }
            .addon-item.drag-over {
                border-color: ${THEME_PURPLE}; background-color: #3d3d3d;
            }
            .addon-logo {
                width: 40px; height: 40px; margin-right: 15px; object-fit: contain;
            }
            .addon-details { display: flex; align-items: center; }
            .form-group { margin-bottom: 15px; }
            .advanced-details summary {
                cursor: pointer; font-weight: bold; color: ${THEME_PURPLE};
                margin: 15px 0;
            }
            .advanced-content {
                padding-left: 10px; border-left: 2px solid #444;
            }
        `;
		document.head.appendChild(style);
	}

	// --- INITIALIZATION ---
	initUIManager();
})();
