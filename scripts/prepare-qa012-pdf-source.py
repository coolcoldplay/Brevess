"""Rebuild QA-012's explicitly supplied, hash-pinned PDF as auditable article text.

Offline, document-specific extraction: no OCR, model, network, or PDF modification.
Coordinates are PDF points from the top-left; page numbers are one-based PDF pages.
"""
import hashlib
import html
import json
from pathlib import Path
import re
from datetime import datetime, timezone

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/qa012-user-pdf-20260924"
PDF = OUT / "neuron-original.pdf"
EXPECTED_HASH = "262ce6c85d923017318bc5940d13d681d3a613473b25353e60a507024ba97cf6"
TITLE = "Anterior zona incerta to ventral tegmental area circuit controls compulsive eating in a binge-eating-disorder mouse model"
URL = "https://www.cell.com/neuron/fulltext/S0896-6273(26)00644-6"
DOI = "10.1016/j.neuron.2026.08.014"
CAPTION_PAGES = {3: (1, 619), 6: (2, 577), 7: (3, 551), 9: (4, 622),
                 11: (5, 603), 13: (6, 700), 15: (7, 701)}
CONTINUATIONS = {4: (1, 629), 8: (3, 676), 10: (4, 544), 12: (5, 610),
                 14: (6, 392), 16: (7, 515)}
MAJOR_HEADINGS = {"SUMMARY", "INTRODUCTION", "RESULTS", "DISCUSSION", "RESOURCE AVAILABILITY",
                  "ACKNOWLEDGMENTS", "AUTHOR CONTRIBUTIONS", "DECLARATION OF INTERESTS",
                  "SUPPLEMENTAL INFORMATION", "REFERENCES", "STAR★METHODS", "STAR METHODS",
                  "METHOD DETAILS", "EXPERIMENTAL MODEL AND STUDY PARTICIPANT DETAILS",
                  "QUANTIFICATION AND STATISTICAL ANALYSIS"}
CATEGORIES = {"Antibodies", "Bacterial and virus strains", "Chemical, peptides, and recombinant proteins",
              "Critical commercial assays", "Deposited data", "Experimental models: Organisms/strains",
              "Oligonucleotides", "Software and algorithms"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def compact(text):
    # Only whitespace normalization: retained hyphens cannot be distinguished
    # automatically as lexical vs. line-wrap hyphens without guessing.
    return re.sub(r"\s+", " ", text).strip()


def joined(lines, preserve_lines=False):
    text = "\n".join(line["text"] for line in lines)
    if preserve_lines:
        return text.strip()
    # Joining a wrapped identifier retains the actual source hyphen.
    text = re.sub(r"-\n(?=\S)", "-", text)
    return compact(text)


def lines_in(page, bbox):
    return page.crop(bbox).extract_text_lines(x_tolerance=1, y_tolerance=3, return_chars=True)


def bbox_of(lines):
    return [round(min(x["x0"] for x in lines), 3), round(min(x["top"] for x in lines), 3),
            round(max(x["x1"] for x in lines), 3), round(max(x["bottom"] for x in lines), 3)]


paragraphs, page_map, regions, resources, corrections = [], [], [], [], []
section = "Title and author information"
major = section


def add(page_num, name, text, bbox, kind="prose", **extra):
    if not text.strip():
        return
    index = sum(p["source"]["page"] == page_num for p in paragraphs) + 1
    p = {"id": f"pdf-p{page_num:03d}-{index:03d}", "section": name, "text": text,
         "source": {"page": page_num, "bbox": bbox, "kind": kind, **extra}}
    paragraphs.append(p)
    return p


def prose(page, page_num, bbox, fixed_section=None, detect_headings=True, kind="prose"):
    global section, major
    lines = lines_in(page, bbox)
    if not lines:
        return
    regions.append({"page": page_num, "bbox": list(bbox), "kind": kind,
                    "rawText": "\n".join(x["text"] for x in lines)})
    buffer, headings = [], []
    left = min(line["x0"] for line in lines)

    def flush():
        if buffer:
            text = joined(buffer, kind == "diagram-text")
            # A visually verified superscript, otherwise flattened by extraction.
            if page_num == 22 and "with titer >1012" in text:
                old = text
                text = text.replace("with titer >1012", "with titer >10^12")
                corrections.append({"page": 22, "before": "with titer >1012", "after": "with titer >10^12",
                                    "reason": "PDF exponent 12 visually verified on rendered page 22", "rawParagraph": old})
            add(page_num, fixed_section or section, text, bbox_of(buffer), kind)
            buffer.clear()

    def flush_heading():
        global section, major
        if not headings:
            return
        title = joined(headings)
        if title in MAJOR_HEADINGS:
            major = "STAR★METHODS — " + title if title in {"METHOD DETAILS", "EXPERIMENTAL MODEL AND STUDY PARTICIPANT DETAILS", "QUANTIFICATION AND STATISTICAL ANALYSIS"} else title
            section = major
        else:
            section = major + " — " + title
        headings.clear()

    for line in lines:
        chars = [c for c in line["chars"] if c["text"].strip()]
        bold = sum("Heavy" in c.get("fontname", "") or "Bold" in c.get("fontname", "") for c in chars)
        is_heading = detect_headings and chars and bold / len(chars) > 0.75
        if is_heading:
            flush()
            # Separate stacked major and subsection headings by vertical whitespace.
            if headings and line["top"] - headings[-1]["bottom"] > 5:
                flush_heading()
            headings.append(line)
            continue
        flush_heading()
        if buffer and (line["top"] - buffer[-1]["bottom"] > 5 or
                       (line["x0"] > left + 5 and buffer[-1]["text"].rstrip().endswith((".", ")"))) or
                       re.match(r"^\([A-Z](?:[ ,–\-]|\))", line["text"])):
            flush()
        buffer.append(line)
    flush()
    flush_heading()


def resource_table(page, page_num, bbox, boundaries):
    # Columns are explicitly read separately; row starts require resource and source.
    # Continuation cells are appended within the same row, never to the next reagent.
    region = page.crop(bbox)
    words = region.extract_words(x_tolerance=1, y_tolerance=3)
    line_groups = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        found = next((g for g in line_groups if abs(g["top"] - word["top"]) < 3), None)
        if found is None:
            found = {"top": word["top"], "words": []}
            line_groups.append(found)
        found["words"].append(word)
    category, active = "", None
    for group in sorted(line_groups, key=lambda g: g["top"]):
        cells = [[] for _ in range(3)]
        for word in sorted(group["words"], key=lambda w: w["x0"]):
            col = 0 if word["x0"] < boundaries[0] else 1 if word["x0"] < boundaries[1] else 2
            cells[col].append(word["text"])
        cells = [" ".join(c) for c in cells]
        whole = " ".join(c for c in cells if c)
        if whole in CATEGORIES:
            category, active = whole, None
            continue
        if cells[0] and cells[1]:
            active = {"page": page_num, "category": category, "cells": cells, "top": group["top"],
                      "bottom": max(w["bottom"] for w in group["words"])}
            resources.append(active)
        elif active:
            for i, cell in enumerate(cells):
                if cell:
                    separator = "" if active["cells"][i].endswith(("-", "/")) else " "
                    active["cells"][i] += separator + cell
            active["bottom"] = max(w["bottom"] for w in group["words"])
        else:
            raise RuntimeError(f"Unassigned resource table text on page {page_num}: {cells!r}")
    for row in [r for r in resources if r["page"] == page_num]:
        p = add(page_num, "STAR★METHODS — Key resources table — " + row["category"],
                " | ".join(f"{label}: {value}" for label, value in zip(["REAGENT or RESOURCE", "SOURCE", "IDENTIFIER"], row["cells"])),
                [bbox[0], round(row["top"], 3), bbox[2], round(row["bottom"], 3)], "resource-table-row")
        row["paragraphId"] = p["id"]
    regions.append({"page": page_num, "bbox": list(bbox), "kind": "resource-table",
                    "rawText": region.extract_text(x_tolerance=1, y_tolerance=3)})


def main():
    global section, major
    original = PDF.read_bytes()
    assert sha(original) == EXPECTED_HASH, "Source PDF hash mismatch"
    with pdfplumber.open(PDF) as document:
        assert len(document.pages) == 55
        for page_num, page in enumerate(document.pages, 1):
            raw = page.extract_text(x_tolerance=1, y_tolerance=3) or ""
            entry = {"page": page_num, "width": page.width, "height": page.height,
                     "rawText": raw, "rawTextSha256": sha(raw.encode()), "paragraphIds": []}
            page_map.append(entry)
            if page_num == 1:
                prose(page, page_num, (40, 85, 550, 165), "Cover — title", False)
                prose(page, page_num, (40, 169, 350, 680), "Cover — graphical abstract and highlights", False)
                prose(page, page_num, (350, 169, 550, 680), "Cover — authors and in brief", False)
            elif page_num == 2:
                prose(page, page_num, (40, 98, 558, 537))
                prose(page, page_num, (40, 537, 300, 742))
                prose(page, page_num, (300, 537, 558, 742))
            elif page_num in CAPTION_PAGES:
                figure, top = CAPTION_PAGES[page_num]
                prose(page, page_num, (40, 95, 558, top), f"Figure {figure} — image labels (PDF text layer)", False, "diagram-text")
                prose(page, page_num, (40, top, 558, 741), f"Figure {figure} — legend", False, "figure-legend")
            elif 3 <= page_num <= 19:
                body_end = CONTINUATIONS.get(page_num, (0, 741))[1]
                prose(page, page_num, (40, 97, 300, body_end))
                prose(page, page_num, (300, 97, 558, body_end))
                if page_num in CONTINUATIONS:
                    figure, top = CONTINUATIONS[page_num]
                    prose(page, page_num, (40, top, 558, 741), f"Figure {figure} — legend (continued)", False, "figure-legend")
            elif page_num == 20:
                resource_table(page, page_num, (50, 169, 547, 709), (201, 370))
            elif page_num == 21:
                resource_table(page, page_num, (57, 127, 552, 451), (208, 377))
                prose(page, page_num, (40, 473, 558, 741))
            elif 22 <= page_num <= 28:
                prose(page, page_num, (40, 97, 558, 741))
            elif page_num == 29:
                prose(page, page_num, (0, 0, page.width, page.height), "Supplemental information — cover", False)
            elif page_num == 55:
                # Coordinate table is retained as lines: spatial column positions in raw sidecar.
                prose(page, page_num, (0, 0, page.width, page.height), "STAR Methods — Supplemental Table S1: stereotaxic coordinates", False, "diagram-text")
            else:
                is_legend_page = bool(re.match(r"Figure S\d+\.", raw))
                number = re.search(r"Figure S(\d+)", raw)
                suffix = number.group(1) if number else "(see page)"
                prose(page, page_num, (0, 0, page.width, page.height),
                      f"Supplemental Figure S{suffix} — " + ("legend" if is_legend_page else "image text and any embedded legend"),
                      False, "figure-legend" if is_legend_page else "diagram-text")
            entry["paragraphIds"] = [p["id"] for p in paragraphs if p["source"]["page"] == page_num]
            assert entry["paragraphIds"], f"No source representation for page {page_num}"
    viruses = [r for r in resources if r["category"] == "Bacterial and virus strains"]
    assert len(viruses) == 21, "Visually reviewed resource table must retain all 21 supplier rows"
    assert all(r["cells"][2] for r in resources)
    aav = [p for p in paragraphs if p["section"].endswith(" — AAV vectors")]
    assert len(aav) == 1 and all(t in aav[0]["text"] for t in ["Taitool", "BrainVTA", "Umibio", "sgRNA1", "sgRNA2", "sgRNA3", ">10^12"])
    provenance = {"sourceType": "用户PDF原文重建HTML", "sourceUrl": URL,
                  "capturedAt": datetime.now(timezone.utc).isoformat(), "pdfFile": "neuron-original.pdf",
                  "pdfSha256": EXPECTED_HASH, "pageCount": 55, "extraction": "pdfplumber spatial text-layer extraction; Poppler visual verification",
                  "boundary": "User-provided PDF reconstructed as HTML, not publisher DOM extraction, OCR, or original 47-paragraph equivalence",
                  "pageMappingFile": "page-map.json", "resourceTableFile": "resource-table.json",
                  "textPolicy": "Whitespace collapsed in prose; line-terminal hyphens retained; Unicode and original names retained; flattened superscripts noted; only titer exponent visually restored as 10^12"}
    article = {"title": TITLE, "doi": DOI, "url": URL, "provenance": provenance, "paragraphs": paragraphs}
    save("article.json", article)
    save("page-map.json", page_map)
    save("extraction-regions.json", regions)
    save("resource-table.json", resources)
    save("virus-coverage.json", {"pdfSha256": EXPECTED_HASH, "resourceTableRows": viruses,
        "aavMethodsParagraphIds": [p["id"] for p in aav],
        "aavMethodsExplicitConstructOccurrences": len(re.findall(r"(?:sc)?AAV\d+/\d+-", aav[0]["text"])),
        "allAavMentionParagraphIds": [p["id"] for p in paragraphs if re.search(r"\bAAV|scAAV|adeno.associated", p["text"], re.I)],
        "mentionContexts": [{"paragraphId": p["id"], "page": p["source"]["page"], "section": p["section"],
                              "mentions": [{"offset": m.start(), "context": p["text"][max(0, m.start()-40):m.start()+180]}
                                           for m in re.finditer(r"(?:sc)?AAV", p["text"])]}
                             for p in paragraphs if re.search(r"(?:sc)?AAV", p["text"])],
        "sourceNamingDifferences": [
            {"page": 26, "quote": "AAV2/9-hSyn-FLEX-GCaMP6s", "note": "Explicit Fiber photometry construct outside the 21 resource supplier rows; retained in full Methods."},
            {"pages": [20,22], "tableQuote": "AAV2/9-hSyn-fDIO-ChrimsonR-mCherry", "methodsQuote": "AAV2/9-hEF1a-fDIO-ChrimsonR-mCherry-ER2-WPRE-pA", "note": "Original promoter/name differences retained; no equivalence asserted."}],
        "scope": "21 resource supplier rows plus complete AAV Methods and every retained source-text mention; no assumed universal unique-tool count; original naming differences retained"})
    save("extraction-audit.json", {"pdfSha256Before": sha(original), "pdfSha256After": sha(PDF.read_bytes()),
        "articleSha256": sha((OUT / "article.json").read_bytes()), "pageCount": 55, "paragraphCount": len(paragraphs),
        "resourceRows": len(resources), "virusSupplierRows": len(viruses), "corrections": corrections,
        "croppingRules": ["PDF pages 2–28: exclude repeated citation box and publisher masthead above y=97 (page 2 begins y=98).",
                          "PDF pages 2–28: exclude journal/page/license footer below y=741 (page 2 two-column body uses y=742).",
                          "PDF page 1: title x=40..550,y=85..165; left graphical-abstract/highlights x=40..350,y=169..680; right authors/in-brief x=350..550,y=169..680; bibliographic footer excluded.",
                          "Resources: page20 x=50..547,y=169..709; page21 x=57..552,y=127..451; table headers/category boundaries reconstructed into row labels and section names.",
                          "Two-column article prose read left column then right; full-width caption continuations read separately after prose. Explicit coordinates retained in extraction-regions.json.",
                          "Supplement pages29–55: no margin crop; every page represented, image text marked separately from prose; PDF never modified."],
        "visualReviewPages": [1, 2, 17, 20, 21, 22, 55], "limitations": ["Superscript typography except the explicitly corrected titer is flattened in plain text.",
                          "Original line-terminal hyphens are retained rather than guessed away.", "Diagram text is a spatial text-layer transcription, not image interpretation; figures are not OCRed.",
                          "Publisher resource table and Methods may use differing construct names; they are preserved separately, not silently reconciled."]})
    body = "\n".join(f'<section data-pdf-page="{p["source"]["page"]}"><h2>{html.escape(p["section"])}</h2><p id="{p["id"]}">{html.escape(p["text"])}</p></section>' for p in paragraphs)
    (OUT / "article-preview.html").write_text('<!doctype html><meta charset="utf-8"><title>' + html.escape(TITLE) + '</title><h1>' + html.escape(TITLE) + '</h1><p>用户PDF原文重建HTML；不是出版社DOM验收。</p>' + body, encoding="utf-8")
    print(json.dumps({"paragraphs": len(paragraphs), "pages": 55, "resourceRows": len(resources), "virusSupplierRows": len(viruses),
                      "articleSha256": sha((OUT / "article.json").read_bytes())}))


if __name__ == "__main__":
    main()
