window.runAuthorMetadataChecks = function() {
 const extract = SciLLM.extractArticleAuthorMetadata;
 const make = extra => new DOMParser().parseFromString(`<head><link rel="canonical" href="https://www.nature.com/articles/test"><meta name="citation_title" content="Test"><meta name="citation_author" content="Noda, Takeshi"><meta name="citation_author" content="Hong, Soyon"></head><body>${extra}</body>`, 'text/html');
 const cases = [
  {name:'Nature surname order, explicit correspondence and affiliation mapping',html:'<div id="author-information-content"><p id="corresponding-author-list">Correspondence to <a>Takeshi Noda</a> or <a>Soyon Hong</a>.</p><ol class="c-article-author-affiliation__list"><li><p class="c-article-author-affiliation__address">University of Osaka</p><p class="c-article-author-affiliation__authors-list">Takeshi Noda</p></li></ol></div>',check:m=>m.authors.length===2&&m.authors.every(a=>a.corresponding)&&m.authors[0].name==='Takeshi Noda'&&m.authors[0].affiliations[0]==='University of Osaka'&&m.authors[1].affiliations.length===0},
  {name:'Unknown names and surname-only references do not create corresponding authors',html:'<div id="author-information-content"><p id="corresponding-author-list">Correspondence to <a>Invented Person</a> and <a>Noda</a>.</p></div>',check:m=>m.authors.length===2&&m.authors.every(a=>a.corresponding===null)},
  {name:'Email link without an explicit correspondence label is insufficient',html:'<div id="author-information-content"><p id="corresponding-author-list">Contact <a href="mailto:a@uni.org">Takeshi Noda</a></p></div>',check:m=>m.authors.every(a=>a.corresponding===null)},
  {name:'Related article author cards are excluded',html:'<aside class="related-articles"><div id="author-information-content"><p id="corresponding-author-list">Correspondence to <a>Takeshi Noda</a>.</p></div></aside>',check:m=>m.authors.every(a=>a.corresponding===null)}
 ];
 return cases.map(c=>{const m=extract(make(c.html));return {name:c.name,pass:c.check(m)}});
};
