/**
 * @name FilterStreams
 * @description Filters a movie's/tv show's episode's streams
 * @updateUrl https://raw.githubusercontent.com/0xA18/stremio-enhanced-plugins/refs/heads/main/versions/filterStreams.txt
 * @version 0.1.5
 * @author a18 corp.
 */

(function () {
    "use strict";

    class DivDropdown {
        elem;
        selected = "All";
        constructor(root, drop, _placeholder) {
            this.root = root;
            this.button = root.querySelector(".multiselect-button-XXdgA.open-TvFQd.button-container-zVLH6");

            this.elem = drop;
            this.placeholder = _placeholder || 'Select';
            this.value = null;

            this.button.addEventListener('click', () => this.toggle());
            
        }

        _uid(prefix) { return `${prefix}-${Math.random().toString(36).slice(2, 9)}`; }

        _bind() {
            // Toggle open/close
            this.button.addEventListener('keydown', (e) => this._onButtonKey(e));

            // Option click
            

            // Keyboard on list
            this.list.addEventListener('keydown', (e) => this._onListKey(e));

            // Click outside
            document.addEventListener('click', (e) => {
                if (!this.root.contains(e.target)) this.close();
            });

            // Focus out closes
            this.root.addEventListener('focusout', (e) => {
                // Delay to allow focus to move within component
                setTimeout(() => { if (!this.root.contains(document.activeElement)) this.close(); }, 0);
            });
        }

        open() {
            this.root.appendChild(this.elem);
            this.list = this.root.querySelector('.dd-list');
            this.options = Array.from(this.root.querySelectorAll('.dd-option'));
            this.labelEl = this.root.querySelector('.label-SoEGc');
            this.activeIndex = -1;
            this.root.querySelector(".icon-gQU96").classList.add("open-TvFQd");
            // ARIA setup
            this.options.forEach((opt, i) => {
                if (!opt.id) opt.id = this._uid('ddopt');
                opt.setAttribute('tabindex', '-1');
            });



            //this._renderLabel();
            this._bind();

            if (this.root.classList.contains('is-open')) return;
            this.root.classList.add('is-open');
            this.button.setAttribute('aria-expanded', 'true');
            // Ensure some active index
            if (this.activeIndex < 0) {
                const selIndex = this._selectedIndex();
                this._setActive(selIndex >= 0 ? selIndex : 0);
            }
            this.list.focus({ preventScroll: false });
            this._scrollActiveIntoView();

            this.options.forEach((opt, i) => {
                opt.addEventListener('click', () => {
                    this._commit(i); this.close(); this.button.focus();
                    if (opt.textContent.replaceAll(" ", "").replaceAll("\n", "") == "All")
                    this._renderLabel();
                });
                opt.addEventListener('mousemove', () => this._setActive(i));
            });

            this.root.querySelector(".dropdown-MWaxp.open-yuN4f.dd-list").addEventListener("click", () => {
                this.close();
            });

            this.options.forEach((opt, i) => {
                if (opt.textContent.replaceAll(" ", "").replaceAll("\n", "").toLowerCase() == this.selected.toLowerCase()){
                    const icon = document.createElement("div");
                    icon.className = "icon-I_g2q";
                    opt.appendChild(icon);
                }
            });
        }

        close() {
            if (!this.root.classList.contains('is-open')) return;
            this.root.classList.remove('is-open');
            this.button.setAttribute('aria-expanded', 'false');
            this.root.querySelector(".icon-I_g2q")?.remove();
            this.root.querySelector(".dd-list").remove();
            this.root.querySelector(".icon-gQU96").classList.remove("open-TvFQd");
        }

        toggle() { this.root.classList.contains('is-open') ? this.close() : this.open(); }

        _onButtonKey(e) {
            switch (e.key) {
            case 'ArrowDown':
            case 'ArrowUp':
            case 'Enter':
            case ' ': // Space
                e.preventDefault();
                this.open();
                break;
                default: break;
            }
        }

        _onListKey(e) {
            const max = this.options.length - 1;
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this._setActive(Math.min(max, (this.activeIndex < 0 ? 0 : this.activeIndex + 1)));
                    this._scrollActiveIntoView();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this._setActive(Math.max(0, (this.activeIndex < 0 ? 0 : this.activeIndex - 1)));
                    this._scrollActiveIntoView();
                    break;
                case 'Home':
                    e.preventDefault();
                    this._setActive(0);
                    this._scrollActiveIntoView();
                    break;
                case 'End':
                    e.preventDefault();
                    this._setActive(max);
                    this._scrollActiveIntoView();
                    break;
                case 'Enter':
                case ' ': // Space
                    e.preventDefault();
                    if (this.activeIndex >= 0) {
                        this._commit(this.activeIndex);
                        this.close();
                        this.button.focus();
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    this.close();
                    this.button.focus();
                    break;
                case 'Tab':
                    this.close();
                    break;
                default:
                    // Typeahead: jump to first option starting with typed char(s)
                    if (e.key.length === 1 && /\S/.test(e.key)) {
                        this._typeahead(e.key);
                    }
            }
        }

        _typeahead(ch) {
            const start = (this.activeIndex + 1) % this.options.length;
            const hay = this.options.map(o => o.textContent.trim().toLowerCase());
            const idx = hay.findIndex((t, i) => hay[(start + i) % hay.length].startsWith(ch.toLowerCase()));
            if (idx !== -1) {
                const target = (start + idx) % hay.length;
                this._setActive(target);
                this._scrollActiveIntoView();
            }
        }

        _setActive(i) {
            if (i < 0 || i >= this.options.length) return;
            if (this.activeIndex === i) return;
            if (this.activeIndex >= 0) this.options[this.activeIndex].classList.remove('is-active');
            this.activeIndex = i;
            const opt = this.options[i];
            opt.classList.add('is-active');
            this.list.setAttribute('aria-activedescendant', opt.id);
        }

        _selectedIndex() {
            return this.options.findIndex(o => o.getAttribute('aria-selected') === 'true');
        }

        _commit(i) {
            const opt = this.options[i];
            this.options.forEach(o => o.setAttribute('aria-selected', 'false'));
            opt.setAttribute('aria-selected', 'true');
            this.value = opt.dataset.value ?? opt.textContent.trim();
            this.root.dataset.value = this.value;
            this._renderLabel(opt.textContent.trim());
            this.root.dispatchEvent(new CustomEvent('change', { detail: { value: this.value, label: opt.textContent.trim() } }));
        }

        _renderLabel(text) {
            const label = text || this.placeholder;
            this.labelEl.textContent = label;
            this.labelEl.classList.toggle('dd-placeholder', !text);
        }

        _scrollActiveIntoView() {
            const opt = this.options[this.activeIndex];
            if (!opt) return;
            const listRect = this.list.getBoundingClientRect();
            const optRect = opt.getBoundingClientRect();
            if (optRect.top < listRect.top) {
                this.list.scrollTop -= (listRect.top - optRect.top) + 4;
            } else if (optRect.bottom > listRect.bottom) {
                this.list.scrollTop += (optRect.bottom - listRect.bottom) + 4;
            }
        }
    }

    class StreamInfo {
        constructor({ title, languages, quality, size, streamOrigin, codecs, colorRange }) {
            this.title = title;
            this.languages = languages;
            this.quality = quality;
            this.size = size;
            this.streamOrigin = streamOrigin;
            this.codecs = codecs;
            this.colorRange = colorRange;
        }
    }

    function getStreamFaceLine(str){
        for (const line of str.split('\n')){
            if (line.startsWith('👤')){
                return line;
            }
        }
        return null;
    }

    function parseStreamElements(links, year) {
        const results = [];

        // Happy.Gilmore.2.2025.2160p.NF.WEB-DL.SDR.LATINO.HINDI.RUS.UKR.Atmos.H265.MP4-BTM
        //👤 27 💾 13.73 GB ⚙️ ThePirateBay
        //Multi Audio / 🇷🇺 / 🇲🇽 / 🇮🇳 / 🇺🇦

        // Happy.gilmore.2.2025.1080p-dual-lat-cinecalidad.rs.mp4
        // 👤 76 💾 2.1 GB ⚙️ Cinecalidad
        // Dual Audio / 🇲🇽

        // Wednesday.S01.2160p.NF.WEB-DL.x265.10bit.HDR.DDP5.1.Atmos-APEX
        // Wednesday.S01E01.Wednesdays.Child.is.Full.of.Woe.2160p.NF.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-APEX.mkv
        // 👤 40 💾 7.94 GB ⚙️ TorrentGalaxy
        links.forEach(link => {
            const lines = link[0].split('\n');
            const i = lines[0].indexOf(year);
            const titleRaw = lines[0].slice(0, i);
            let splitter = '.';
            if (titleRaw[titleRaw.length - 1] == '(') splitter = titleRaw[titleRaw.length - 2];
            else splitter = titleRaw[titleRaw.length - 1];
            const afterTitle = lines[0].slice(0 + lines[0].indexOf(year));
            let languages;
            
            if (lines[lines.length - 1].split(" / ").length > 1){
                languages = lines[lines.length - 1].split(" / ");
                // TODO: check every index of the array
                if (languages[0].toLowerCase() == "dual audio" || languages[0].toLowerCase() == "multi audio"|| languages[0].toLowerCase() == "multi subs")
                    languages.shift();
            }
            else languages = undefined;

            let size = undefined;
            let streamOrigin = undefined;
            let faceLine = getStreamFaceLine(link[0]);
            if (faceLine){
                size = faceLine.split(' ')[3] + " " + faceLine.split(' ')[4];
                streamOrigin = faceLine.split(' ')[6];
            }

            const codecPattern = /\b(HEVC|HDR|HDR10|x265|x264|AV1|H\.264|H\.265)\b/gi;
            const codecs = Array.from(lines[0].matchAll(codecPattern), m => m[1]);

            const qualityPattern = /\b(4K|1080p|720p|576p|480p|BDRip|BRRip|HDRip|DVDRip|WEBRip|WEB-DL|BluRay)\b/gi;
            const quality = Array.from(link[1].matchAll(qualityPattern), m => m[1])[0];

            const colorRangePattern = /\b(SDR|HDR|HDR10|DV|Dolby Vision)\b/gi;
            const match = Array.from(link[1].matchAll(colorRangePattern), m => m[1])[0];
            const colorRange = match ?? 'SDR';
            console.log("Color Range found: ", colorRange);

            results.push(new StreamInfo({
                titleRaw,
                languages,
                quality,
                size,
                streamOrigin,
                codecs,
                colorRange,
            }));
        });

        return results;
    }

    let selectedStreams = new StreamInfo({
        title: "all", 
        languages: "all", 
        quality: "all", 
        size: "all", 
        streamOrigin: "all", 
        codecs: "all",
        colorRange: "all"
    });
    // TODO: remove non-found streams from dropdown
    function filterStreams(e) {
        const streamsContainer = document
            .querySelector('.streams-list-Y1lCM')
            .querySelector('.streams-container-bbSc4');

        let allStreams = 0;
        let hiddenStreams = 0;

        for (const elem of streamsContainer.querySelectorAll('a')) {
            const streamLeft = elem.querySelector(".addon-name-tC8PX");
            const streamRight = elem.querySelector(".description-container-vW_De");

            const qualityMatch =
                streamLeft.textContent.includes(selectedStreams.quality) ||
                selectedStreams.quality.toLowerCase() === "all";

            const languageMatch =
                streamRight.textContent.includes(selectedStreams.languages) ||
                selectedStreams.languages.toLowerCase() === "all";

            const faceLine = getStreamFaceLine(streamRight.textContent);
            let originMatch = undefined;
            if (faceLine){
                originMatch = faceLine.includes(selectedStreams.streamOrigin) ||
                selectedStreams.streamOrigin.toLowerCase() === "all";
            }
            
            let colorRangeMatch = undefined;
            if (streamLeft.textContent.includes(selectedStreams.colorRange) ||
                selectedStreams.colorRange.toLowerCase() === "all"){
                colorRangeMatch = true;
            } else {
                if (selectedStreams.colorRange == "SDR" &&
                    !streamLeft.textContent.includes("HDR") &&
                    !streamLeft.textContent.includes("HDR10") &&
                    !streamLeft.textContent.includes("DV") &&
                    !streamLeft.textContent.includes("Dolby Vision"))
                    colorRangeMatch = true;
                else
                    colorRangeMatch = false;
            }


            if (qualityMatch && languageMatch && originMatch && colorRangeMatch) {
                elem.style.visibility = "visible";
                elem.style.position = "relative";
            } else {
                elem.style.visibility = "hidden";
                elem.style.position = "absolute";
                hiddenStreams++;
            }

            console.log(faceLine, qualityMatch, languageMatch, originMatch);
            console.log(selectedStreams);

            allStreams++;
        }
    }

    function createDropdown(found, text, className, onChange){
        if (found.length < 2) return;
        const selector1 = document.createElement("div");
        selector1.innerHTML = 
            `<div tabindex="0" aria-haspopup="listbox" aria-expanded="true" class="multiselect-button-XXdgA open-TvFQd button-container-zVLH6">
                <div class="label-SoEGc">${text}</div>
                <svg class="icon-gQU96" viewBox="0 0 512 512">
                <path d="M93.10000000000036 203.24199999999996l144.9 161.225c2.1 2.411 4.7 4.365 7.6 5.733 2.9 1.414 6.1 2.264 9.4 2.503 3.2 0.239 6.5-0.14 9.6-1.113 3.1-0.984 6-2.531 8.5-4.556 0.9-0.758 1.8-1.619 2.6-2.567l144.9-161.225c3.1-3.467 4.9-7.684 5.6-12.168 0.7-4.486 0-9.068-1.9-13.184-2-4.13-5.2-7.627-9.2-10.076s-8.7-3.747-13.5-3.738h-289.7c-3.3-0.009-6.6 0.595-9.6 1.781-4.6 1.768-8.5 4.808-11.1 8.722-2.7 3.906-4.2 8.483-4.2 13.168 0.1 5.694 2.3 11.175 6.1 15.495" style="fill: currentcolor;"></path>
                </svg>
            </div>`;
        selector1.classList.add("dropdown", "observer-ignore", className, "multiselect-menu-qMdaj", "select-input-container-irGn_");
        
        selector1.addEventListener('change', (e) => {
            onChange(e);
            filterStreams(e);
            dropObj.selected = e.detail.value;
        });
        //selector.appendChild(selector1);

        const dropdown = document.createElement("div");
        dropdown.innerHTML =
        `
            <div tabindex="0" aria-selected="true" class="dd-option option-HcOSE undefined button-container-zVLH6">
                <div class="label-IR8xX">All</div>
            </div>
        `;
        dropdown.className = "dropdown-MWaxp open-yuN4f dd-list";
        dropdown.role = "option";
        dropdown.tabIndex = 0;
        dropdown.ariaExpanded = "false";
        dropdown.classList.add("dd-list");

        
        //selector1.appendChild(dropdown);
        
        for (const obj of found){
            if (obj != "undefined" && obj){
                const newElem = document.createElement("div");
                newElem.tabIndex = 0;
                newElem.ariaSelected = "false";
                newElem.classList.add("dd-option", "option-HcOSE", "button-container-zVLH6");
                newElem.id = "dd-list-1";
                //newElem.tabIndex = "-1";
                newElem.role = "option";
                const elemTitle = document.createElement("div");
                elemTitle.classList.add("label-IR8xX");
                elemTitle.textContent = obj;
                newElem.appendChild(elemTitle);

                dropdown.appendChild(newElem);
            }
        }

        const dropObj = new DivDropdown(selector1, dropdown, text);

        // selector1.addEventListener("click", () => {
        //     selector1.appendChild(dropdown);
        //     new DivDropdown(selector1, text);
        // });

        const parents = document.querySelectorAll(".select-choices-wrapper-xGzfs.filter-streams");
        console.log("Parents found: ", parents[0].querySelectorAll(".dropdown").length);
        if (parents[0].querySelectorAll(".dropdown").length < 2)
            parents[0].insertBefore(selector1, parents[0].firstChild);
        else
            parents[1].insertBefore(selector1, parents[1].firstChild);
    }

    function createFilters(){
        const streamsContainer = document.querySelector('.streams-list-Y1lCM').querySelector('.streams-container-bbSc4');
        
        const streamLinks = Array.from(streamsContainer.querySelectorAll('a'))
                .map(a => {
                const desc = a.querySelector('.description-container-vW_De');
                const addon = a.querySelector(".addon-name-tC8PX");
                return [desc ? desc.textContent.trim() : null, addon.textContent];
                })
            .filter(Boolean); // remove nulls
            // Optional: log or return the links
        console.log(document.readyState);

        const filmYear = document.querySelector(".release-info-label-LPJMB").innerHTML;
        const streams = parseStreamElements(streamLinks, filmYear);
        
        const container = document.createElement("div");
        container.classList.add("select-choices-wrapper-xGzfs", "filter-streams", "first-index");
        const container2 = document.createElement("div");
        container2.classList.add("select-choices-wrapper-xGzfs", "filter-streams", "second-index");
        const parent = document.querySelector(".streams-list-Y1lCM.streams-list-container-xYMJo");
        parent.insertBefore(container2, parent.firstChild);
        parent.insertBefore(container, parent.firstChild);

        let foundQualities = [];
        for (const stream of streams){
            if (!foundQualities.includes(stream.quality))
                foundQualities.push(stream.quality);
        }

        let foundLanguages = [];
        for (const stream of streams){
            if (stream.languages != undefined){
                for (const lang of stream.languages){
                    if (!foundLanguages.includes(lang))
                        foundLanguages.push(lang);
                }
            }
            
        }

        let foundOrigins = [];
        for (const stream of streams){
            if (!foundOrigins.includes(stream.streamOrigin)){
                foundOrigins.push(stream.streamOrigin);

            }
        }

        let foundColorRanges = [];
        for (const stream of streams){
            if (!foundColorRanges.includes(stream.colorRange)){
                foundColorRanges.push(stream.colorRange);
            }
        }
        // note: they have to be in reverse order
        createDropdown(foundColorRanges, "Color Range", "color-range-selection", (e) => {selectedStreams.colorRange = e.detail.value;});
        createDropdown(foundOrigins, "Origin", "origin-selection", (e) => {selectedStreams.streamOrigin = e.detail.value;});
        createDropdown(foundLanguages, "Language", "language-selection", (e) => {selectedStreams.languages = e.detail.value;});
        createDropdown(foundQualities, "Quality", "quality-selection", (e) => {selectedStreams.quality = e.detail.value;});
    }

    
    function checkElements() {
        const existsStreamsList = document.querySelector('.streams-list-Y1lCM');
        const missingDropdown = !document.querySelector('.dropdown.observer-ignore');
        const streamsInited = document.querySelector(".label-container-XOyzm.stream-container-JPdah.button-container-zVLH6");

        if (existsStreamsList && missingDropdown && streamsInited) {
            createFilters();
        }
    }

    // Reduced from 200ms to 500ms for better performance
    const intervalId = setInterval(checkElements, 500);

    window.onload = function(){
        const style = document.createElement("style");
        style.innerHTML =
    `
    .dropdown{
        min-width: 0!important;
    }
    .first-index{
        z-index: 999!important;
        position: relative!important;
    }
    .second-index{
        z-index: 998!important;
    }
    `
            document.body.appendChild(style);
        }();

})();