import java.awt.image.BufferedImage;
import java.awt.RenderingHints;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;

/**
 * Conservative recovery pass for layouts PDFFigures2 cannot join itself.
 * It never replaces PDFFigures2: it only supplies longer cross-page captions
 * and renders a whole preceding page region when a numbered Figure is absent.
 */
public final class BrevessPdfFallback {
  private static final Pattern FIGURE_START = Pattern.compile(
      "^\\s*[\\u2022\\u2023\\u2043\\u25AA\\u25AB\\u25B6\\u25C0-\\u25C2\\u25E6]*\\s*" +
      "(?:Figure|Fig\\.)\\s*(S?\\s*\\d+)(?![A-Za-z0-9])\\s*([.:|])?\\s*(.*)$",
      Pattern.CASE_INSENSITIVE);
  private static final Pattern GARBLED_FIGURE_START = Pattern.compile(
      "^\\s*F(?=[^\\d]{0,16}i)(?=[^\\d]{0,16}g)(?=[^\\d]{0,16}u)" +
      "(?=[^\\d]{0,16}r)(?=[^\\d]{0,16}e)[^\\d]{1,16}" +
      "(S?\\s*\\d+)[^\\d]{0,6}([.:|])\\s*(.*)$",
      Pattern.CASE_INSENSITIVE);
  private static final Pattern PANEL_START = Pattern.compile(
      "^\\s*\\([A-Z](?:\\s*[-\\u2010-\\u2015]\\s*[A-Z])?\\)\\s+.*$");
  private static final Pattern CONTINUED = Pattern.compile(
      "legend\\s+continued\\s+on\\s+next\\s+page", Pattern.CASE_INSENSITIVE);
  private static final Pattern BODY_REFERENCE_LEAD = Pattern.compile(
      "^(?:shows?|showed|illustrates?|illustrated|depicts?|depicted|demonstrates?|" +
      "demonstrated|presents?|presented|provides?|provided|indicates?|indicated|" +
      "reveals?|revealed|was|were|is|are|and|or)\\b", Pattern.CASE_INSENSITIVE);
  private static final Pattern PANEL_REFERENCE_START = Pattern.compile(
      "^\\s*(?:Figure|Fig\\.)\\s*S?\\s*\\d+\\s*[A-Z]" +
      "(?:\\s*[-\\u2010-\\u2015]\\s*[A-Z])?" +
      "(?:\\s*,\\s*[A-Z](?:\\s*[-\\u2010-\\u2015]\\s*[A-Z])?)*" +
      "\\)\\s*[.,;:]?",
      Pattern.CASE_INSENSITIVE);

  private BrevessPdfFallback() {}

  private static final class Chunk {
    final float x;
    final float y;
    final float width;
    final float height;
    final String text;

    Chunk(float x, float y, float width, float height, String text) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      this.text = text;
    }
  }

  private static final class Line {
    float x;
    float y;
    float right;
    float height;
    final List<Chunk> chunks = new ArrayList<Chunk>();

    String text() {
      Collections.sort(chunks, new Comparator<Chunk>() {
        public int compare(Chunk left, Chunk right) {
          return Float.compare(left.x, right.x);
        }
      });
      StringBuilder result = new StringBuilder();
      float previousRight = -1;
      for (Chunk chunk : chunks) {
        if (result.length() > 0 && chunk.x - previousRight > 1.2f) result.append(' ');
        result.append(chunk.text);
        previousRight = Math.max(previousRight, chunk.x + chunk.width);
      }
      return normalize(result.toString());
    }
  }

  private static final class PageStripper extends PDFTextStripper {
    final List<Chunk> chunks = new ArrayList<Chunk>();

    PageStripper(int pageNumber) throws IOException {
      super();
      setSortByPosition(true);
      setStartPage(pageNumber);
      setEndPage(pageNumber);
    }

    @Override
    protected void writeString(String text, List<TextPosition> positions) throws IOException {
      if (positions == null || positions.isEmpty()) return;
      TextPosition first = positions.get(0);
      float width = 0;
      float height = 0;
      for (TextPosition position : positions) {
        width += position.getWidthDirAdj();
        height = Math.max(height, position.getHeightDir());
      }
      String clean = normalize(text);
      if (!clean.isEmpty()) {
        chunks.add(new Chunk(first.getXDirAdj(), first.getYDirAdj(), width, height, clean));
      }
    }
  }

  private static final class Caption {
    String label;
    String number;
    int captionPageIndex;
    int figurePageIndex;
    float startY;
    float captionX;
    float captionWidth;
    int textBeforeCaptionChars;
    String text;
    boolean captionListEntry;
  }

  private static final class RenderedFigure {
    final File image;
    final float x;
    final float y;
    final float width;
    final float height;

    RenderedFigure(File image, float x, float y, float width, float height) {
      this.image = image;
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
    }
  }

  private static boolean horizontallyCompatible(Line line, Chunk chunk) {
    float chunkRight = chunk.x + chunk.width;
    float gap = Math.max(line.x - chunkRight, chunk.x - line.right);
    float tolerance = Math.max(18f, Math.min(line.height, chunk.height) * 2.2f);
    return gap <= tolerance;
  }

  private static boolean sameTextColumn(Line anchor, Line candidate) {
    float overlap = Math.max(0f,
        Math.min(anchor.right, candidate.right) - Math.max(anchor.x, candidate.x));
    float narrowWidth = Math.max(1f,
        Math.min(anchor.right - anchor.x, candidate.right - candidate.x));
    return overlap >= narrowWidth * 0.18f || Math.abs(anchor.x - candidate.x) <= 24f;
  }

  private static String normalize(String value) {
    return value == null ? "" : value.replace('\u0000', ' ')
        .replaceAll("\\s+", " ").trim();
  }

  private static String normalizeFigurePrefix(String value) {
    String normalized = normalize(value);
    // Some PDFs paint the same caption glyph twice. PDFBox then exposes a
    // visually normal "Figure" as "FFiigguurree", which must still be
    // recognized as a caption anchor.
    boolean doubledGlyphs = normalized.matches(
        "(?i)^\\s*F{2,}\\s*i{2,}\\s*g{2,}\\s*u{2,}\\s*r{2,}\\s*e{2,}.*$");
    normalized = normalized.replaceFirst(
        "(?i)^\\s*F+\\s*i+\\s*g+\\s*u+\\s*r+\\s*e+", "Figure");
    normalized = normalized.replaceFirst(
        "(?i)^\\s*F+\\s*i+\\s*g+\\s*\\.+", "Fig.");
    if (doubledGlyphs) {
      Matcher number = Pattern.compile("(?i)^Figure\\s*(S?)(\\d+)").matcher(normalized);
      if (number.find() && number.group(2).length() % 2 == 0) {
        String digits = number.group(2);
        StringBuilder collapsed = new StringBuilder();
        boolean paired = true;
        for (int index = 0; index < digits.length(); index += 2) {
          if (digits.charAt(index) != digits.charAt(index + 1)) {
            paired = false;
            break;
          }
          collapsed.append(digits.charAt(index));
        }
        if (paired) {
          normalized = normalized.substring(0, number.start(2)) + collapsed +
              normalized.substring(number.end(2));
        }
      }
    }
    return normalized;
  }

  private static Matcher figureStart(String value) {
    Matcher standard = FIGURE_START.matcher(value);
    if (standard.matches()) return standard;
    Matcher garbled = GARBLED_FIGURE_START.matcher(value);
    return garbled.matches() ? garbled : null;
  }

  private static List<Line> pageLines(PDDocument document, int pageIndex) throws IOException {
    PageStripper stripper = new PageStripper(pageIndex + 1);
    stripper.getText(document);
    List<Chunk> chunks = stripper.chunks;
    Collections.sort(chunks, new Comparator<Chunk>() {
      public int compare(Chunk left, Chunk right) {
        int byY = Float.compare(left.y, right.y);
        return byY != 0 ? byY : Float.compare(left.x, right.x);
      }
    });
    List<Line> lines = new ArrayList<Line>();
    for (Chunk chunk : chunks) {
      Line target = null;
      for (int index = lines.size() - 1; index >= 0 && index >= lines.size() - 8; index--) {
        Line candidate = lines.get(index);
        float tolerance = Math.max(2.6f, Math.min(candidate.height, chunk.height) * 0.55f);
        if (Math.abs(candidate.y - chunk.y) <= tolerance &&
            horizontallyCompatible(candidate, chunk)) {
          target = candidate;
          break;
        }
      }
      if (target == null) {
        target = new Line();
        target.x = chunk.x;
        target.y = chunk.y;
        target.right = chunk.x + chunk.width;
        target.height = chunk.height;
        lines.add(target);
      }
      target.chunks.add(chunk);
      target.x = Math.min(target.x, chunk.x);
      target.right = Math.max(target.right, chunk.x + chunk.width);
      target.height = Math.max(target.height, chunk.height);
    }
    Collections.sort(lines, new Comparator<Line>() {
      public int compare(Line left, Line right) {
        int byY = Float.compare(left.y, right.y);
        return byY != 0 ? byY : Float.compare(left.x, right.x);
      }
    });
    return lines;
  }

  private static String labelFor(String compactNumber, String suffix) {
    String compact = compactNumber.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
    String digits = compact.startsWith("S") ? compact.substring(1) : compact;
    int number = Integer.parseInt(digits);
    return "Figure " + (compact.startsWith("S") ? "S" : "") + number +
        (suffix == null ? "" : suffix.toUpperCase(Locale.ROOT));
  }

  private static List<Caption> captions(PDDocument document) throws IOException {
    List<List<Line>> allLines = new ArrayList<List<Line>>();
    for (int pageIndex = 0; pageIndex < document.getNumberOfPages(); pageIndex++) {
      allLines.add(pageLines(document, pageIndex));
    }
    List<Caption> result = new ArrayList<Caption>();
    for (int pageIndex = 0; pageIndex < allLines.size(); pageIndex++) {
      PDRectangle box = document.getPage(pageIndex).getMediaBox();
      List<Line> lines = allLines.get(pageIndex);
      for (int lineIndex = 0; lineIndex < lines.size(); lineIndex++) {
        Line line = lines.get(lineIndex);
        String firstText = normalizeFigurePrefix(line.text());
        if (Boolean.getBoolean("brevess.debug.lines") &&
            firstText.toLowerCase(Locale.ROOT).contains("fig")) {
          System.err.println("PAGE=" + (pageIndex + 1) + " Y=" + line.y + " " + firstText);
          for (Chunk chunk : line.chunks) {
            System.err.println("  CHUNK X=" + chunk.x + " W=" + chunk.width + " " + chunk.text);
          }
        }
        if (PANEL_REFERENCE_START.matcher(firstText).find()) continue;
        Matcher start = figureStart(firstText);
        if (start == null) continue;
        String delimiter = normalize(start.group(2));
        String captionLead = normalize(start.group(3));
        if (delimiter.isEmpty() && BODY_REFERENCE_LEAD.matcher(captionLead).find()) continue;
        if (delimiter.isEmpty() &&
            captionLead.matches(
                "^[A-Z](?:\\s*[-\\u2010-\\u2015]\\s*[A-Z])?" +
                "(?:\\s*,\\s*[A-Z](?:\\s*[-\\u2010-\\u2015]\\s*[A-Z])?)*" +
                "\\)\\s*[.,;:]?\\s*[\\s\\S]*$")) {
          continue;
        }
        if (delimiter.isEmpty() && !captionLead.isEmpty() && captionLead.length() < 8) continue;
        Caption caption = new Caption();
        caption.label = labelFor(start.group(1), "");
        caption.number = caption.label.substring("Figure ".length());
        caption.captionPageIndex = pageIndex;
        caption.startY = line.y;
        caption.captionX = line.x;
        caption.captionWidth = Math.max(1f, line.right - line.x);
        int textBeforeCaptionChars = 0;
        for (int priorIndex = 0; priorIndex < lineIndex; priorIndex++) {
          Line prior = lines.get(priorIndex);
          if (prior.y >= line.y - 8f || !sameTextColumn(line, prior)) continue;
          String priorText = prior.text();
          if (!priorText.matches("^\\d+$")) textBeforeCaptionChars += priorText.length();
        }
        caption.textBeforeCaptionChars = textBeforeCaptionChars;
        StringBuilder text = new StringBuilder(firstText);
        float lastY = line.y;
        for (int cursor = lineIndex + 1; cursor < lines.size(); cursor++) {
          Line next = lines.get(cursor);
          String nextText = normalizeFigurePrefix(next.text());
          if (figureStart(nextText) != null) break;
          if (next.y < lastY - 2f) break;
          if (next.y > box.getHeight() - 22f) break;
          if (next.y - line.y > box.getHeight() * 0.34f) break;
          if (nextText.matches("^\\d+$")) continue;
          if (!sameTextColumn(line, next)) continue;
          text.append(' ').append(nextText);
          caption.captionX = Math.min(caption.captionX, next.x);
          caption.captionWidth = Math.max(caption.captionWidth, next.right - caption.captionX);
          lastY = next.y;
        }
        if (CONTINUED.matcher(text.toString()).find() && pageIndex + 1 < allLines.size()) {
          PDRectangle nextBox = document.getPage(pageIndex + 1).getMediaBox();
          List<Line> nextLines = allLines.get(pageIndex + 1);
          int continuationStart = -1;
          for (int cursor = 0; cursor < nextLines.size(); cursor++) {
            Line next = nextLines.get(cursor);
            if (next.y > nextBox.getHeight() * 0.48f && PANEL_START.matcher(next.text()).matches()) {
              continuationStart = cursor;
              break;
            }
          }
          if (continuationStart >= 0) {
            for (int cursor = continuationStart; cursor < nextLines.size(); cursor++) {
              Line next = nextLines.get(cursor);
              String nextText = normalizeFigurePrefix(next.text());
              if (next.y > nextBox.getHeight() - 22f || figureStart(nextText) != null) break;
              if (!nextText.matches("^\\d+$")) text.append(' ').append(nextText);
            }
          }
        }
        caption.text = normalize(text.toString()
            .replaceAll("(?i)\\s*legend\\s+continued\\s+on\\s+next\\s+page\\s*", " "));
        caption.figurePageIndex = pageIndex;
        // Missing whole-page plates most commonly put the complete caption on
        // the following page. Existing PDFFigures2 results are not recropped,
        // so this conservative previous-page rule only affects absent labels.
        boolean narrowSideCaption = caption.captionWidth < box.getWidth() * 0.56f;
        if (line.y < box.getHeight() * 0.22f && pageIndex > 0 && !narrowSideCaption) {
          caption.figurePageIndex = pageIndex - 1;
        }
        result.add(caption);
      }
    }
    return result;
  }

  private static float parseFloat(String value, float fallback) {
    try { return Float.parseFloat(value); } catch (Exception error) { return fallback; }
  }

  private static int clamp(int value, int minimum, int maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  private static float denseBodyTextStart(PDDocument document, int pageIndex,
      PDRectangle media) throws IOException {
    List<Line> lines = pageLines(document, pageIndex);
    // Side-caption review layouts often resume body text immediately below a
    // half-page plate. Starting at 43% catches that boundary without examining
    // the title/header area where ordinary Figure labels are dense.
    float minimumY = media.getHeight() * 0.43f;
    for (int index = 0; index < lines.size(); index++) {
      Line first = lines.get(index);
      if (first.y < minimumY || first.y > media.getHeight() * 0.94f) continue;
      if (Boolean.getBoolean("brevess.debug.lines")) {
        String debugText = first.text();
        if (debugText.length() > 96) debugText = debugText.substring(0, 96);
        System.err.println("BODY-LINE PAGE=" + (pageIndex + 1) + " Y=" + first.y +
            " X=" + first.x + " R=" + first.right + " N=" + debugText.length() +
            " " + debugText);
      }
      int leftLines = 0;
      int rightLines = 0;
      int fullWidthLines = 0;
      int characters = 0;
      float windowEnd = first.y + 58f;
      for (int cursor = index; cursor < lines.size(); cursor++) {
        Line line = lines.get(cursor);
        if (line.y > windowEnd) break;
        String value = line.text();
        float lineWidth = line.right - line.x;
        if (value.length() < 26 || lineWidth < media.getWidth() * 0.24f) continue;
        if (lineWidth >= media.getWidth() * 0.64f) {
          fullWidthLines++;
        } else if ((line.x + line.right) / 2f < media.getWidth() / 2f) {
          leftLines++;
        } else {
          rightLines++;
        }
        characters += value.length();
      }
      // Body text below a plate normally resumes in both columns (or as a true
      // full-width paragraph). Requiring that geometry prevents a long legend
      // beside the plate from being mistaken for the next body section.
      boolean twoColumnBody = leftLines >= 3 && rightLines >= 3 && characters >= 220;
      boolean fullWidthBody = fullWidthLines >= 4 && characters >= 240;
      if (Boolean.getBoolean("brevess.debug.lines") &&
          (leftLines + rightLines + fullWidthLines) > 0) {
        System.err.println("BODY-CANDIDATE PAGE=" + (pageIndex + 1) + " Y=" + first.y +
            " LEFT=" + leftLines + " RIGHT=" + rightLines +
            " FULL=" + fullWidthLines + " CHARS=" + characters);
      }
      if (twoColumnBody || fullWidthBody) return first.y;
    }
    return -1f;
  }

  private static float denseBodyTextEndBefore(PDDocument document, int pageIndex,
      float captionY, PDRectangle media) throws IOException {
    List<Line> lines = pageLines(document, pageIndex);
    float latestEnd = -1f;
    for (int index = 0; index < lines.size(); index++) {
      Line first = lines.get(index);
      if (first.y < media.getHeight() * 0.07f ||
          first.y > captionY - media.getHeight() * 0.18f) continue;
      int longLines = 0;
      int characters = 0;
      float groupEnd = first.y;
      float windowEnd = first.y + 68f;
      for (int cursor = index; cursor < lines.size(); cursor++) {
        Line line = lines.get(cursor);
        if (line.y > windowEnd || line.y > captionY - media.getHeight() * 0.18f) break;
        String value = line.text();
        if (value.length() < 42 || line.right - line.x < media.getWidth() * 0.50f) continue;
        longLines++;
        characters += value.length();
        groupEnd = Math.max(groupEnd, line.y + line.height);
      }
      if (longLines >= 4 && characters >= 260) latestEnd = Math.max(latestEnd, groupEnd);
    }
    return latestEnd;
  }

  private static float topPageFurnitureEnd(PDDocument document, int pageIndex,
      PDRectangle media) throws IOException {
    float latestEnd = -1f;
    for (Line line : pageLines(document, pageIndex)) {
      if (line.y > media.getHeight() * 0.12f) break;
      String text = normalize(line.text());
      if (text.matches("(?i)^(?:review|review article|original article|short article|" +
          "accepted manuscript|article in press|cell press|nature|science|neuron|" +
          "current biology|downloaded from https?://.*|doi\\s*:.*|\\d+)$")) {
        latestEnd = Math.max(latestEnd, line.y + line.height + 6f);
      }
    }
    return latestEnd;
  }

  private static float bottomPageFurnitureStart(PDDocument document, int pageIndex,
      PDRectangle media) throws IOException {
    float earliestStart = -1f;
    for (Line line : pageLines(document, pageIndex)) {
      if (line.y < media.getHeight() * 0.91f) continue;
      String text = normalize(line.text());
      boolean pageNumber = text.matches("^(?:[ivxlcdm]+|\\d{1,5})$");
      boolean journalFooter = text.matches("(?i)^.*(?:\\bvolume\\s+\\d+|\\bvol\\.?\\s*\\d+|" +
          "\\bissue\\s+\\d+|\\bcopyright\\b|©|\\bdoi\\s*:|https?://).*$");
      if (pageNumber || journalFooter) {
        if (earliestStart < 0 || line.y < earliestStart) earliestStart = line.y;
      }
    }
    return earliestStart;
  }

  private static RenderedFigure renderMissing(PDDocument document, PDFRenderer renderer,
      Caption caption, File outputDirectory, int dpi, float[] preferredBox) throws IOException {
    int pageIndex = clamp(caption.figurePageIndex, 0, document.getNumberOfPages() - 1);
    PDPage page = document.getPage(pageIndex);
    PDRectangle media = page.getMediaBox();
    boolean preferredUsable = preferredBox[0] >= 0 && preferredBox[1] >= 0 &&
        preferredBox[2] >= media.getWidth() * 0.16f &&
        preferredBox[3] >= media.getHeight() * 0.16f &&
        preferredBox[0] + preferredBox[2] <= media.getWidth() + 2f &&
        preferredBox[1] + preferredBox[3] <= media.getHeight() + 2f;
    float x = preferredUsable ? preferredBox[0] : media.getWidth() * 0.025f;
    float y = preferredUsable ? preferredBox[1] : media.getHeight() * 0.025f;
    float width = preferredUsable ? preferredBox[2] : media.getWidth() * 0.95f;
    float height = preferredUsable ? preferredBox[3] : media.getHeight() * 0.90f;
    if (pageIndex == caption.captionPageIndex) {
      boolean captionInOneColumn = caption.captionWidth < media.getWidth() * 0.56f;
      boolean captionBelowPlate = caption.startY > media.getHeight() * 0.60f;
      boolean oppositeColumnFigure = captionInOneColumn && !captionBelowPlate &&
          (caption.textBeforeCaptionChars >= 180 ||
           caption.startY < media.getHeight() * 0.25f);
      if (captionBelowPlate) {
        // Review articles and author manuscripts often place a one- or
        // two-column plate above a caption near the page foot. A narrow
        // caption box does not imply a narrow Figure, so preserve the full
        // page width and stop just above the legend.
        x = media.getWidth() * 0.018f;
        y = media.getHeight() * 0.025f;
        float furnitureEnd = topPageFurnitureEnd(document, pageIndex, media);
        if (furnitureEnd > y && furnitureEnd < caption.startY - media.getHeight() * 0.18f) {
          y = furnitureEnd;
        }
        width = media.getWidth() * 0.964f;
        float bodyEnd = denseBodyTextEndBefore(
            document, pageIndex, caption.startY, media);
        if (bodyEnd > y && bodyEnd < caption.startY - media.getHeight() * 0.18f) {
          y = Math.min(caption.startY - media.getHeight() * 0.18f, bodyEnd + 8f);
        }
        height = Math.max(media.getHeight() * 0.18f, caption.startY - y - 10f);
      } else if (oppositeColumnFigure) {
        boolean captionOnLeft = caption.captionX + caption.captionWidth / 2f <
            media.getWidth() / 2f;
        float margin = media.getWidth() * 0.025f;
        if (captionOnLeft) {
          x = Math.min(media.getWidth() - margin,
              caption.captionX + caption.captionWidth + margin);
          width = media.getWidth() - x - margin;
        } else {
          x = margin;
          // Side legends often begin slightly inside the visual plate's right
          // edge (arrows and callouts can extend beneath that text column).
          // Keep a small overlap allowance, but cap it before readable legend
          // prose becomes part of the recovered Figure.
          width = Math.max(media.getWidth() * 0.50f,
              caption.captionX - x + media.getWidth() * 0.070f);
          width = Math.min(width, media.getWidth() * 0.76f);
          width = Math.min(width, media.getWidth() - x - margin);
        }
        y = Math.max(media.getHeight() * 0.025f, caption.startY - 18f);
        height = media.getHeight() * 0.91f;
        float bodyStart = denseBodyTextStart(document, pageIndex, media);
        if (bodyStart > y + media.getHeight() * 0.22f) {
          height = Math.min(height, bodyStart - y - 8f);
        }
      } else {
        if (captionInOneColumn) {
          float margin = media.getWidth() * 0.018f;
          x = Math.max(margin, caption.captionX - margin);
          width = Math.min(media.getWidth() - x - margin,
              caption.captionWidth + margin * 2f);
        }
        // TextPosition Y is the caption baseline, so leave enough ascender and
        // leading space above it to keep the legend out of the Figure bitmap.
        float beforeCaption = caption.startY - y - 20f;
        if (beforeCaption > media.getHeight() * 0.18f) height = Math.min(height, beforeCaption);
      }
    } else {
      // A caption at the top of the following page usually describes a full
      // plate on the preceding page. Keep generous margins so edge panels are
      // never lost merely because another Figure supplied a narrow crop box.
      x = media.getWidth() * 0.018f;
      y = media.getHeight() * 0.025f;
      float furnitureEnd = topPageFurnitureEnd(document, pageIndex, media);
      if (furnitureEnd > y && furnitureEnd < media.getHeight() * 0.18f) y = furnitureEnd;
      width = media.getWidth() * 0.964f;
      height = media.getHeight() * 0.93f;
      float bodyStart = denseBodyTextStart(document, pageIndex, media);
      if (bodyStart > y + media.getHeight() * 0.4f) {
        height = Math.min(height, bodyStart - y - 8f);
      }
      float furnitureStart = bottomPageFurnitureStart(document, pageIndex, media);
      if (furnitureStart > y + media.getHeight() * 0.4f) {
        height = Math.min(height, furnitureStart - y - 6f);
      }
    }
    x = Math.max(0, Math.min(x, media.getWidth() - 1));
    y = Math.max(0, Math.min(y, media.getHeight() - 1));
    width = Math.max(1, Math.min(width, media.getWidth() - x));
    height = Math.max(1, Math.min(height, media.getHeight() - y));
    BufferedImage pageImage = renderer.renderImageWithDPI(pageIndex, dpi, ImageType.RGB);
    float scaleX = pageImage.getWidth() / media.getWidth();
    float scaleY = pageImage.getHeight() / media.getHeight();
    int cropX = clamp(Math.round(x * scaleX), 0, pageImage.getWidth() - 1);
    int cropY = clamp(Math.round(y * scaleY), 0, pageImage.getHeight() - 1);
    int cropWidth = clamp(Math.round(width * scaleX), 1, pageImage.getWidth() - cropX);
    int cropHeight = clamp(Math.round(height * scaleY), 1, pageImage.getHeight() - cropY);
    if (Boolean.getBoolean("brevess.debug.lines")) {
      System.err.println("CROP " + caption.label + " PAGE=" + (pageIndex + 1) +
          " X=" + x + " Y=" + y + " W=" + width + " H=" + height +
          " PX=" + cropX + "," + cropY + "," + cropWidth + "," + cropHeight);
    }
    BufferedImage crop = pageImage.getSubimage(cropX, cropY, cropWidth, cropHeight);
    File image = new File(outputDirectory,
        "fallback-" + caption.label.replace(' ', '-') + ".png");
    ImageIO.write(crop, "png", image);
    return new RenderedFigure(image, x, y, width, height);
  }

  private static String json(String value) {
    String source = value == null ? "" : value;
    StringBuilder result = new StringBuilder("\"");
    for (int index = 0; index < source.length(); index++) {
      char character = source.charAt(index);
      switch (character) {
        case '\\': result.append("\\\\"); break;
        case '"': result.append("\\\""); break;
        case '\n': result.append("\\n"); break;
        case '\r': result.append("\\r"); break;
        case '\t': result.append("\\t"); break;
        default:
          if (character < 0x20) result.append(String.format("\\u%04x", (int) character));
          else result.append(character);
      }
    }
    return result.append('"').toString();
  }

  private static String captionJson(Caption caption) {
    return "{\"label\":" + json(caption.label) +
        ",\"pageIndex\":" + caption.captionPageIndex +
        ",\"figurePageIndex\":" + caption.figurePageIndex +
        ",\"startY\":" + caption.startY +
        ",\"captionX\":" + caption.captionX +
        ",\"captionWidth\":" + caption.captionWidth +
        ",\"textBeforeCaptionChars\":" + caption.textBeforeCaptionChars +
        ",\"caption\":" + json(caption.text) + "}";
  }

  private static int captionScore(Caption caption) {
    Matcher panels = Pattern.compile("\\([A-Z](?:\\s*[-\\u2010-\\u2015]\\s*[A-Z])?\\)")
        .matcher(caption.text);
    int count = 0;
    while (panels.find()) count++;
    return count * 10000 + Math.min(caption.text.length(), 9000);
  }

  private static void markCaptionListEntries(List<Caption> captions) {
    Map<Integer, List<Caption>> byPage = new HashMap<Integer, List<Caption>>();
    for (Caption caption : captions) {
      List<Caption> page = byPage.get(caption.captionPageIndex);
      if (page == null) {
        page = new ArrayList<Caption>();
        byPage.put(caption.captionPageIndex, page);
      }
      page.add(caption);
    }
    for (List<Caption> page : byPage.values()) {
      int supplemental = 0;
      int shortSupplemental = 0;
      for (Caption caption : page) {
        if (!caption.number.toUpperCase(Locale.ROOT).startsWith("S")) continue;
        supplemental++;
        if (caption.text.length() <= 260) shortSupplemental++;
      }
      // A compact run of four or more supplementary legends on one article
      // page is the journal's supplementary-material index, not four plates.
      if (supplemental >= 4 && shortSupplemental >= 3) {
        for (Caption caption : page) {
          if (caption.number.toUpperCase(Locale.ROOT).startsWith("S")) {
            caption.captionListEntry = true;
          }
        }
      }
    }
  }

  private static int maximumExistingMainFigure(Set<String> existing) {
    int maximum = -1;
    Pattern label = Pattern.compile("^figure\\s+(\\d+)$", Pattern.CASE_INSENSITIVE);
    for (String value : existing) {
      Matcher match = label.matcher(value.trim());
      if (match.matches()) maximum = Math.max(maximum, Integer.parseInt(match.group(1)));
    }
    return maximum;
  }

  private static int mainFigureNumber(Caption caption) {
    if (caption == null || caption.number == null ||
        caption.number.toUpperCase(Locale.ROOT).startsWith("S")) return -1;
    try {
      return Integer.parseInt(caption.number.replaceAll("[^0-9]", ""));
    } catch (Exception error) {
      return -1;
    }
  }

  private static Integer standalonePlateNumber(
      PDDocument document, int pageIndex) throws IOException {
    PDRectangle media = document.getPage(pageIndex).getMediaBox();
    for (Line line : pageLines(document, pageIndex)) {
      if (line.y > media.getHeight() * 0.26f) break;
      String text = normalizeFigurePrefix(line.text());
      Matcher start = figureStart(text);
      if (start == null) continue;
      String delimiter = normalize(start.group(2));
      String remainder = normalize(start.group(3));
      if (!delimiter.isEmpty() || !remainder.isEmpty()) continue;
      String label = labelFor(start.group(1), "");
      if (label.toUpperCase(Locale.ROOT).startsWith("FIGURE S")) continue;
      try {
        return Integer.parseInt(label.substring("Figure ".length()));
      } catch (Exception ignored) {
        return null;
      }
    }
    return null;
  }

  private static int meaningfulPageTextCharacters(
      PDDocument document, int pageIndex) throws IOException {
    int characters = 0;
    for (Line line : pageLines(document, pageIndex)) {
      String text = normalize(line.text());
      if (text.isEmpty() || text.matches("^\\d+$")) continue;
      if (text.matches("(?i)^Downloaded\\s+from\\s+https?://.*$")) continue;
      if (text.matches("(?i)^Accepted\\s+Manuscript$")) continue;
      characters += text.replaceAll("\\s+", "").length();
    }
    if (Boolean.getBoolean("brevess.debug.lines")) {
      System.err.println("PAGE-TEXT PAGE=" + (pageIndex + 1) +
          " CHARS=" + characters);
    }
    return characters;
  }

  private static boolean remapRasterPlateRun(
      PDDocument document, Map<Integer, Caption> mainByNumber,
      int maximumCaptionPage) throws IOException {
    List<Integer> numbers = new ArrayList<Integer>(mainByNumber.keySet());
    Collections.sort(numbers);
    if (numbers.size() < 3) return false;
    for (int index = 1; index < numbers.size(); index++) {
      if (numbers.get(index) != numbers.get(index - 1) + 1) return false;
    }
    int runLength = numbers.size();
    int pageCount = document.getNumberOfPages();
    for (int start = maximumCaptionPage + 1;
         start + runLength <= pageCount; start++) {
      boolean sparse = true;
      for (int offset = 0; offset < runLength; offset++) {
        if (meaningfulPageTextCharacters(document, start + offset) > 240) {
          sparse = false;
          break;
        }
      }
      if (!sparse) continue;
      // Rasterized author plates normally occupy the terminal run. Allow one
      // trailing cover/blank page, but do not steal a sparse run in the middle
      // of ordinary supplementary material.
      if (pageCount - (start + runLength) > 1) continue;
      for (int offset = 0; offset < numbers.size(); offset++) {
        mainByNumber.get(numbers.get(offset)).figurePageIndex = start + offset;
      }
      return true;
    }
    return false;
  }

  /**
   * Accepted manuscripts from several publishers put all legends in one
   * appendix and then append one full-page plate per Figure. In that layout
   * the longest caption is deliberately selected for metadata, but its page
   * must not be rendered as the Figure. A run of standalone "Figure N"
   * headers after the complete legend block is a high-confidence signal for
   * the detached plates. Requiring at least three ordered matches prevents an
   * isolated body reference or section label from triggering the remap.
   */
  private static void remapDetachedPlateAppendix(
      PDDocument document, List<Caption> captions) throws IOException {
    Map<Integer, Caption> mainByNumber = new HashMap<Integer, Caption>();
    int minimumCaptionPage = document.getNumberOfPages();
    int maximumCaptionPage = -1;
    for (Caption caption : captions) {
      int number = mainFigureNumber(caption);
      if (number < 1 || caption.text.length() < 48) continue;
      mainByNumber.put(number, caption);
      minimumCaptionPage = Math.min(minimumCaptionPage, caption.captionPageIndex);
      maximumCaptionPage = Math.max(maximumCaptionPage, caption.captionPageIndex);
    }
    if (mainByNumber.size() < 3 || maximumCaptionPage < 0) return;
    if (minimumCaptionPage < document.getNumberOfPages() * 0.45f) return;
    if (maximumCaptionPage - minimumCaptionPage > Math.max(8, mainByNumber.size() + 2)) return;

    Map<Integer, Integer> platePages = new HashMap<Integer, Integer>();
    for (int pageIndex = maximumCaptionPage + 1;
         pageIndex < document.getNumberOfPages(); pageIndex++) {
      Integer number = standalonePlateNumber(document, pageIndex);
      if (number != null && mainByNumber.containsKey(number) &&
          !platePages.containsKey(number)) {
        platePages.put(number, pageIndex);
      }
    }
    if (platePages.size() < 3) {
      remapRasterPlateRun(document, mainByNumber, maximumCaptionPage);
      return;
    }

    List<Integer> numbers = new ArrayList<Integer>(platePages.keySet());
    Collections.sort(numbers);
    int orderedMatches = 0;
    int previousPage = -1;
    for (Integer number : numbers) {
      int pageIndex = platePages.get(number);
      if (pageIndex <= previousPage) {
        remapRasterPlateRun(document, mainByNumber, maximumCaptionPage);
        return;
      }
      previousPage = pageIndex;
      orderedMatches++;
    }
    if (orderedMatches < 3) return;

    for (Integer number : numbers) {
      Caption caption = mainByNumber.get(number);
      if (caption != null) caption.figurePageIndex = platePages.get(number);
    }
  }

  private static List<Caption> inferSequenceGaps(
      PDDocument document, List<Caption> ordered) {
    List<Caption> inferred = new ArrayList<Caption>();
    for (int index = 0; index + 1 < ordered.size(); index++) {
      Caption left = ordered.get(index);
      Caption right = ordered.get(index + 1);
      int leftNumber = mainFigureNumber(left);
      int rightNumber = mainFigureNumber(right);
      int numberGap = rightNumber - leftNumber;
      int pageGap = right.figurePageIndex - left.figurePageIndex;
      if (leftNumber < 1 || numberGap <= 1 || numberGap > 4 || pageGap < numberGap) continue;
      for (int offset = 1; offset < numberGap; offset++) {
        int pageIndex = left.figurePageIndex +
            Math.round((float) pageGap * offset / numberGap);
        if (pageIndex <= left.figurePageIndex || pageIndex >= right.figurePageIndex) continue;
        PDRectangle media = document.getPage(pageIndex).getMediaBox();
        Caption caption = new Caption();
        caption.label = "Figure " + (leftNumber + offset);
        caption.number = String.valueOf(leftNumber + offset);
        caption.captionPageIndex = pageIndex;
        caption.figurePageIndex = pageIndex;
        caption.startY = media.getHeight() * 0.82f;
        caption.captionX = media.getWidth() * 0.07f;
        caption.captionWidth = media.getWidth() * 0.86f;
        caption.text = caption.label;
        inferred.add(caption);
      }
    }
    return inferred;
  }

  public static void main(String[] args) throws Exception {
    if (args.length < 8) {
      throw new IllegalArgumentException(
          "Usage: PDF outputDir dpi existingLabels boxX boxY boxWidth boxHeight");
    }
    File pdf = new File(args[0]);
    File outputDirectory = new File(args[1]);
    int dpi = Math.max(72, Math.min(400, Integer.parseInt(args[2])));
    Set<String> existing = new HashSet<String>();
    for (String label : args[3].split(",")) {
      if (!label.trim().isEmpty()) existing.add(label.trim().toLowerCase(Locale.ROOT));
    }
    float[] preferredBox = new float[] {
      parseFloat(args[4], -1), parseFloat(args[5], -1),
      parseFloat(args[6], -1), parseFloat(args[7], -1)
    };
    outputDirectory.mkdirs();
    PDDocument document = PDDocument.load(pdf);
    try {
      List<Caption> extractedCaptions = captions(document);
      markCaptionListEntries(extractedCaptions);
      LinkedHashMap<String, Caption> bestByLabel = new LinkedHashMap<String, Caption>();
      for (Caption caption : extractedCaptions) {
        if (caption.captionListEntry) continue;
        String key = caption.label.toLowerCase(Locale.ROOT);
        Caption current = bestByLabel.get(key);
        if (current == null || captionScore(caption) > captionScore(current)) {
          bestByLabel.put(key, caption);
        }
      }
      List<Caption> captions = new ArrayList<Caption>(bestByLabel.values());
      Collections.sort(captions, new Comparator<Caption>() {
        public int compare(Caption left, Caption right) {
          String leftNumber = left.number.toUpperCase(Locale.ROOT).replace("S", "");
          String rightNumber = right.number.toUpperCase(Locale.ROOT).replace("S", "");
          int leftValue = Integer.parseInt(leftNumber.replaceAll("[^0-9].*$", ""));
          int rightValue = Integer.parseInt(rightNumber.replaceAll("[^0-9].*$", ""));
          return leftValue - rightValue;
        }
      });
      for (Caption inferred : inferSequenceGaps(document, captions)) {
        String key = inferred.label.toLowerCase(Locale.ROOT);
        if (!bestByLabel.containsKey(key)) bestByLabel.put(key, inferred);
      }
      captions = new ArrayList<Caption>(bestByLabel.values());
      Collections.sort(captions, new Comparator<Caption>() {
        public int compare(Caption left, Caption right) {
          int leftValue = mainFigureNumber(left);
          int rightValue = mainFigureNumber(right);
          if (leftValue >= 0 && rightValue >= 0) return leftValue - rightValue;
          return left.label.compareToIgnoreCase(right.label);
        }
      });
      remapDetachedPlateAppendix(document, captions);
      if (preferredBox[0] < 0 || preferredBox[1] < 0 ||
          preferredBox[2] <= 0 || preferredBox[3] <= 0) {
        PDRectangle media = document.getPage(0).getMediaBox();
        preferredBox[0] = media.getWidth() * 0.018f;
        preferredBox[1] = media.getHeight() * 0.025f;
        preferredBox[2] = media.getWidth() * 0.964f;
        preferredBox[3] = media.getHeight() * 0.90f;
      }
      PDFRenderer renderer = new PDFRenderer(document);
      renderer.setSubsamplingAllowed(true);
      RenderingHints renderingHints = new RenderingHints(
          RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_OFF);
      renderingHints.put(RenderingHints.KEY_TEXT_ANTIALIASING,
          RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
      renderingHints.put(RenderingHints.KEY_ALPHA_INTERPOLATION,
          RenderingHints.VALUE_ALPHA_INTERPOLATION_SPEED);
      renderer.setRenderingHints(renderingHints);
      List<Caption> missing = new ArrayList<Caption>();
      List<RenderedFigure> images = new ArrayList<RenderedFigure>();
      int maximumExistingMain = maximumExistingMainFigure(existing);
      for (Caption caption : captions) {
        if (!existing.contains(caption.label.toLowerCase(Locale.ROOT))) {
          int mainNumber = mainFigureNumber(caption);
          if (mainNumber > 0 && maximumExistingMain > 0 &&
              mainNumber > maximumExistingMain + 4) continue;
          missing.add(caption);
          images.add(renderMissing(document, renderer, caption, outputDirectory, dpi, preferredBox));
        }
      }
      StringBuilder result = new StringBuilder("{\"captions\":[");
      for (int index = 0; index < captions.size(); index++) {
        if (index > 0) result.append(',');
        result.append(captionJson(captions.get(index)));
      }
      result.append("],\"figures\":[");
      for (int index = 0; index < missing.size(); index++) {
        if (index > 0) result.append(',');
        Caption caption = missing.get(index);
        RenderedFigure rendered = images.get(index);
        result.append("{\"figType\":\"Figure\",\"name\":")
            .append(json(caption.number))
            .append(",\"page\":").append(caption.figurePageIndex)
            .append(",\"caption\":").append(json(caption.text))
            .append(",\"regionBoundary\":{\"x1\":").append(rendered.x)
            .append(",\"y1\":").append(rendered.y)
            .append(",\"x2\":").append(rendered.x + rendered.width)
            .append(",\"y2\":").append(rendered.y + rendered.height).append('}')
            .append(",\"imageFile\":").append(json(rendered.image.getName())).append('}');
      }
      result.append("]}");
      System.out.print(result.toString());
    } finally {
      document.close();
    }
  }
}
