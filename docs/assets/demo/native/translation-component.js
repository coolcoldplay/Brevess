/* Exact production bilingual renderer; public prepared translations only. */
window.BVCreateTranslationUI = function() {
 const displaySources=new WeakMap();
 const destroyed=false,epoch=0,translationsHidden=false;
 const confirmedEntry=()=>null,clearPending=()=>{},clearFailure=()=>{},persistRecord=()=>{};
 const checkNavigation=()=>true,sourceMatches=record=>record.element.textContent===record.text;
 /* production:paintTranslation:start */
        function paintTranslation(record, translatedText, { partial = false } = {}) {
            const confirmed = confirmedEntry(record);
            if (confirmed?.manuallyEdited && translatedText !== confirmed.translatedText) return;
            if (!partial) clearPending(record);
            clearFailure(record);
            if (!record.translation?.isConnected) {
                record.translation = document.createElement('div');
                record.translation.className = 'sci-bilingual-translation';
                record.translation.setAttribute('data-sci-plugin-ui', '');
                record.translation.setAttribute('data-sci-translation', '');
                record.translation.setAttribute('lang', 'zh');
                record.translation.setAttribute('dir', 'auto');
                record.translation.setAttribute('translate', 'no');
                record.translation.addEventListener('input', () => {
                    if (destroyed || record.epoch !== epoch || !checkNavigation() || !sourceMatches(record)) return;
                    const entry = confirmedEntry(record);
                    if (entry?.manuallyEdited) persistRecord(record, entry);
                });
                record.translation.addEventListener('pointermove', event => hoverTranslationSentence(record, event), {passive: true});
                record.translation.addEventListener('pointerover', event => hoverTranslationSentence(record, event), {passive: true});
                record.translation.addEventListener('pointerleave', clearSentencePair, {passive: true});
                displaySources.set(record.translation, record.element);
            }
            const sourceEnd = partial ? confirmed?.sourceEnd : record.text.length;
            if (record.lastPaintedText && record.lastPaintedText !== translatedText) {
                if (!confirmed?.manuallyEdited && translatedText.startsWith(record.lastPaintedText) && sourceEnd > record.paintedSourceEnd) {
                    // A validated incremental result gives an exact alignment boundary between complete sentences.
                    const endsSentence = /[.!?。！？][”’"')）\]]*\s*$/u;
                    if (endsSentence.test(record.lastPaintedText) && endsSentence.test(record.text.slice(0, record.paintedSourceEnd))) {
                        (record.sentenceBreaks ||= []).push({en: record.paintedSourceEnd, zh: record.lastPaintedText.length});
                    }
                } else record.sentenceBreaks = [];
            }
            record.paintedSourceEnd = sourceEnd;
            record.partial = partial;
            if (partial) record.translation.setAttribute('data-sci-translation-partial', '');
            else record.translation.removeAttribute('data-sci-translation-partial');
            if (record.translation.textContent !== translatedText) {
                if (readingPair?.record === record) clearSentencePair();
                record.translation.textContent = translatedText;
            }
            record.lastPaintedText = translatedText;
            record.translation.hidden = translationsHidden;
            if (record.anchor.nextSibling !== record.translation) record.anchor.after(record.translation);
        }
/* production:paintTranslation:end */
 return {paint:paintTranslation};
};
