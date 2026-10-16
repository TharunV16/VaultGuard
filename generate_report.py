import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
import os

def create_vaultguard_report():
    doc = docx.Document()

    # Configure Margins (1 inch all around as per standard Anna University / academic template)
    for section in doc.sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.25)
        section.right_margin = Inches(1.0)
        section.different_first_page_header_footer = True
        
        # Header & Footer
        footer = section.footer
        f_p = footer.paragraphs[0]
        f_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    # Configure Default Style
    style_normal = doc.styles['Normal']
    style_normal.font.name = 'Times New Roman'
    style_normal.font.size = Pt(12)
    style_normal.font.color.rgb = RGBColor(0, 0, 0)
    style_normal.paragraph_format.line_spacing = 1.5
    style_normal.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    style_normal.paragraph_format.space_after = Pt(6)

    def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
        tcPr = cell._tc.get_or_add_tcPr()
        tcMar = OxmlElement('w:tcMar')
        for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
            node = OxmlElement(f'w:{m}')
            node.set(qn('w:w'), str(val))
            node.set(qn('w:type'), 'dxa')
            tcMar.append(node)
        tcPr.append(tcMar)

    def format_table(table, col_widths, headers=True):
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        for i, row in enumerate(table.rows):
            # prevent split across pages
            trPr = row._tr.get_or_add_trPr()
            trPr.append(parse_xml(f'<w:cantSplit {nsdecls("w")}/>'))
            if i == 0 and headers:
                trPr.append(parse_xml(f'<w:tblHeader {nsdecls("w")}/>'))
            for j, cell in enumerate(row.cells):
                cell.width = Inches(col_widths[j])
                cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
                set_cell_margins(cell, top=120, bottom=120, left=140, right=140)
                # set borders
                tcPr = cell._tc.get_or_add_tcPr()
                tcBorders = parse_xml(
                    f'<w:tcBorders {nsdecls("w")}>'
                    f'<w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                    f'<w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                    f'<w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                    f'<w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                    f'</w:tcBorders>'
                )
                tcPr.append(tcBorders)
                for p in cell.paragraphs:
                    p.paragraph_format.line_spacing = 1.15
                    p.paragraph_format.space_after = Pt(2)
                    if i == 0 and headers:
                        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                        for run in p.runs:
                            run.font.bold = True
                            run.font.size = Pt(10.5)
                    else:
                        for run in p.runs:
                            run.font.size = Pt(10)

    def add_page_number(run):
        fldChar1 = parse_xml(r'<w:fldChar %s w:fldCharType="begin"/>' % nsdecls('w'))
        instrText = parse_xml(r'<w:instrText %s xml:space="preserve"> PAGE </w:instrText>' % nsdecls('w'))
        fldChar2 = parse_xml(r'<w:fldChar %s w:fldCharType="separate"/>' % nsdecls('w'))
        fldChar3 = parse_xml(r'<w:fldChar %s w:fldCharType="end"/>' % nsdecls('w'))
        run._r.append(fldChar1)
        run._r.append(instrText)
        run._r.append(fldChar2)
        run._r.append(fldChar3)

    def add_heading_1(text):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(12)
        p.paragraph_format.space_after = Pt(12)
        p.paragraph_format.line_spacing = 1.5
        run = p.add_run(text)
        run.bold = True
        run.font.name = 'Times New Roman'
        run.font.size = Pt(14)
        return p

    def add_heading_2(text):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.space_before = Pt(12)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.line_spacing = 1.5
        run = p.add_run(text)
        run.bold = True
        run.font.name = 'Times New Roman'
        run.font.size = Pt(12)
        return p

    def add_heading_3(text):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.space_before = Pt(8)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.5
        run = p.add_run(text)
        run.bold = True
        run.font.name = 'Times New Roman'
        run.font.size = Pt(11.5)
        return p

    def add_para(text, bold_prefix=None):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        p.paragraph_format.line_spacing = 1.5
        p.paragraph_format.space_after = Pt(6)
        if bold_prefix:
            r_pre = p.add_run(bold_prefix)
            r_pre.bold = True
            r_pre.font.name = 'Times New Roman'
            r_pre.font.size = Pt(12)
        r = p.add_run(text)
        r.font.name = 'Times New Roman'
        r.font.size = Pt(12)
        return p

    def add_bullet(text, bold_prefix=None):
        p = doc.add_paragraph(style='List Bullet')
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        p.paragraph_format.line_spacing = 1.5
        p.paragraph_format.space_after = Pt(4)
        if bold_prefix:
            r_pre = p.add_run(bold_prefix)
            r_pre.bold = True
            r_pre.font.name = 'Times New Roman'
            r_pre.font.size = Pt(12)
        r = p.add_run(text)
        r.font.name = 'Times New Roman'
        r.font.size = Pt(12)
        return p

    def add_code_block(title, source_file, code_str):
        p_t = doc.add_paragraph()
        p_t.paragraph_format.space_before = Pt(8)
        p_t.paragraph_format.space_after = Pt(2)
        p_t.paragraph_format.line_spacing = 1.15
        r_t = p_t.add_run(title)
        r_t.bold = True
        r_t.font.name = 'Times New Roman'
        r_t.font.size = Pt(11)

        p_s = doc.add_paragraph()
        p_s.paragraph_format.space_before = Pt(0)
        p_s.paragraph_format.space_after = Pt(4)
        p_s.paragraph_format.line_spacing = 1.15
        r_s = p_s.add_run(f"Source file: {source_file}")
        r_s.italic = True
        r_s.font.name = 'Times New Roman'
        r_s.font.size = Pt(10)

        tbl = doc.add_table(rows=1, cols=1)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = tbl.cell(0, 0)
        cell.width = Inches(6.2)
        set_cell_margins(cell, top=100, bottom=100, left=120, right=120)
        
        tcPr = cell._tc.get_or_add_tcPr()
        shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="F8F9FA"/>')
        tcPr.append(shd)
        tcBorders = parse_xml(
            f'<w:tcBorders {nsdecls("w")}>'
            f'<w:top w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
            f'<w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>'
            f'<w:bottom w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
            f'<w:right w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
            f'</w:tcBorders>'
        )
        tcPr.append(tcBorders)

        cp = cell.paragraphs[0]
        cp.paragraph_format.line_spacing = 1.05
        cp.paragraph_format.space_after = Pt(0)
        cr = cp.add_run(code_str.strip())
        cr.font.name = 'Consolas'
        cr.font.size = Pt(9.5)
        cr.font.color.rgb = RGBColor(30, 41, 59)

        p_spacer = doc.add_paragraph()
        p_spacer.paragraph_format.space_before = Pt(4)
        p_spacer.paragraph_format.space_after = Pt(4)

    # ================= PAGE 1: TITLE PAGE =================
    p_title = doc.add_paragraph()
    p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_title.paragraph_format.space_before = Pt(36)
    p_title.paragraph_format.space_after = Pt(18)
    p_title.paragraph_format.line_spacing = 1.5
    r = p_title.add_run("VAULTGUARD – ZERO-KNOWLEDGE PASSWORD SECURITY AND CREDENTIAL MANAGEMENT PLATFORM")
    r.bold = True
    r.font.name = 'Times New Roman'
    r.font.size = Pt(15)

    p_rep = doc.add_paragraph()
    p_rep.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_rep.paragraph_format.space_before = Pt(24)
    p_rep.paragraph_format.space_after = Pt(18)
    r = p_rep.add_run("A PROJECT REPORT")
    r.bold = True
    r.font.name = 'Times New Roman'
    r.font.size = Pt(13)

    p_sub = doc.add_paragraph()
    p_sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_sub.paragraph_format.space_before = Pt(12)
    p_sub.paragraph_format.space_after = Pt(6)
    r = p_sub.add_run("Submitted by\n")
    r.font.size = Pt(12)
    r_name = p_sub.add_run("R. VEDANTH (310624205297)")
    r_name.bold = True
    r_name.font.size = Pt(13)

    p_award = doc.add_paragraph()
    p_award.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_award.paragraph_format.space_before = Pt(24)
    p_award.paragraph_format.space_after = Pt(18)
    r = p_award.add_run("in partial fulfillment for the award of the Degree\nof\n")
    r.italic = True
    r.font.size = Pt(12)
    r_deg = p_award.add_run("BACHELOR OF ENGINEERING\nin\nINFORMATION TECHNOLOGY")
    r_deg.bold = True
    r_deg.font.size = Pt(13)

    p_inst = doc.add_paragraph()
    p_inst.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_inst.paragraph_format.space_before = Pt(60)
    p_inst.paragraph_format.space_after = Pt(12)
    r = p_inst.add_run("EASWARI ENGINEERING COLLEGE,\n(AN AUTONOMOUS INSTITUTION) – AFFILIATED TO ANNA UNIVERSITY,\nCHENNAI\n\nOCTOBER 2026")
    r.bold = True
    r.font.name = 'Times New Roman'
    r.font.size = Pt(12)

    doc.add_page_break()

    # ================= PAGE 2: BONAFIDE CERTIFICATE =================
    p_col = doc.add_paragraph()
    p_col.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_col.paragraph_format.space_before = Pt(24)
    p_col.paragraph_format.space_after = Pt(6)
    r = p_col.add_run("EASWARI ENGINEERING COLLEGE\n")
    r.bold = True
    r.font.size = Pt(14)
    r_sub = p_col.add_run("(An Autonomous Institution, Affiliated to Anna University)\nBharathi Salai, Ramapuram, Chennai – 600089")
    r_sub.font.size = Pt(11)

    p_bon = doc.add_paragraph()
    p_bon.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_bon.paragraph_format.space_before = Pt(36)
    p_bon.paragraph_format.space_after = Pt(36)
    r = p_bon.add_run("BONAFIDE CERTIFICATE")
    r.bold = True
    r.font.size = Pt(14)

    p_cert = doc.add_paragraph()
    p_cert.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p_cert.paragraph_format.line_spacing = 1.5
    p_cert.paragraph_format.space_before = Pt(12)
    p_cert.paragraph_format.space_after = Pt(120)
    p_cert.add_run("Certified that this mini project report titled “")
    r_t = p_cert.add_run("VAULTGUARD – ZERO-KNOWLEDGE PASSWORD SECURITY AND CREDENTIAL MANAGEMENT PLATFORM")
    r_t.bold = True
    p_cert.add_run("” is the Bonafide work of “")
    r_n = p_cert.add_run("R. VEDANTH (310624205297)")
    r_n.bold = True
    p_cert.add_run("”, who carried out the project work under my supervision.")

    # Signatures table
    tbl_sig = doc.add_table(rows=1, cols=2)
    tbl_sig.alignment = WD_TABLE_ALIGNMENT.CENTER
    for cell in tbl_sig.rows[0].cells:
        cell.width = Inches(3.1)
    p_hod = tbl_sig.cell(0, 0).paragraphs[0]
    p_hod.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r = p_hod.add_run("HEAD OF THE DEPARTMENT")
    r.bold = True
    r.font.size = Pt(11)

    p_sup = tbl_sig.cell(0, 1).paragraphs[0]
    p_sup.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = p_sup.add_run("SUPERVISOR")
    r.bold = True
    r.font.size = Pt(11)

    doc.add_page_break()

    # ================= PAGE 3: CERTIFICATE OF VIVA-VOCE =================
    p_col = doc.add_paragraph()
    p_col.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_col.paragraph_format.space_before = Pt(24)
    p_col.paragraph_format.space_after = Pt(6)
    r = p_col.add_run("EASWARI ENGINEERING COLLEGE\n")
    r.bold = True
    r.font.size = Pt(14)
    r_sub = p_col.add_run("(An Autonomous Institution, Affiliated to Anna University)\nBharathi Salai, Ramapuram, Chennai – 600089")
    r_sub.font.size = Pt(11)

    p_bon = doc.add_paragraph()
    p_bon.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_bon.paragraph_format.space_before = Pt(24)
    p_bon.paragraph_format.space_after = Pt(24)
    r = p_bon.add_run("CERTIFICATE OF VIVA-VOCE-EXAMINATION")
    r.bold = True
    r.font.size = Pt(13)

    p_cert = doc.add_paragraph()
    p_cert.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p_cert.paragraph_format.line_spacing = 1.5
    p_cert.paragraph_format.space_before = Pt(12)
    p_cert.paragraph_format.space_after = Pt(100)
    p_cert.add_run("This is to certify that the Viva Voce Examination of the Project Work entitled “")
    r_t = p_cert.add_run("VAULTGUARD – ZERO-KNOWLEDGE PASSWORD SECURITY AND CREDENTIAL MANAGEMENT PLATFORM")
    r_t.bold = True
    p_cert.add_run("” submitted by Mr. ")
    r_n = p_cert.add_run("R. VEDANTH (Reg. No. 310624205297)")
    r_n.bold = True
    p_cert.add_run(" in partial fulfillment of the requirements for the award of the degree of Bachelor of Engineering was conducted on 15/10/2026 in the Department of Information Technology, Easwari Engineering College, Ramapuram – Chennai.")

    tbl_exam = doc.add_table(rows=1, cols=2)
    tbl_exam.alignment = WD_TABLE_ALIGNMENT.CENTER
    for cell in tbl_exam.rows[0].cells:
        cell.width = Inches(3.1)
    
    p_int = tbl_exam.cell(0, 0).paragraphs[0]
    p_int.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p_int.paragraph_format.line_spacing = 1.3
    r = p_int.add_run("Internal Examiner\n\nName :\nDesignation :\nAddress :\n\nDate: 15/10/2026")
    r.font.size = Pt(11)
    
    p_ext = tbl_exam.cell(0, 1).paragraphs[0]
    p_ext.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p_ext.paragraph_format.line_spacing = 1.3
    r = p_ext.add_run("External Examiner\n\nName :\nDesignation :\nAddress :")
    r.font.size = Pt(11)

    doc.add_page_break()

    # ================= PAGE 4: ABSTRACT =================
    add_heading_1("ABSTRACT")
    add_para("Modern internet users maintain dozens of online accounts across critical financial, enterprise, and personal platforms. Due to human memory constraints, individuals routinely resort to creating weak passwords and reusing the exact same credentials across multiple unrelated websites. This widespread behavioral pattern severely elevates cybersecurity risks: a single credential breach on an insecure third-party web service triggers credential-stuffing and account-takeover attacks across all associated accounts. Furthermore, conventional server-centric password storage designs expose master passwords and user secrets to server compromise, insider attacks, and database leaks.")
    add_para("This project presents VaultGuard, a comprehensive full-stack zero-knowledge password security and credential management platform built on the MERN architecture (MongoDB, Express 5, React, Node.js). VaultGuard enforces a mathematically verifiable zero-knowledge security paradigm where master passwords and unencrypted vault secrets never leave the client browser. Master credentials are processed client-side via PBKDF2-SHA256 (600,000 iterations) and HKDF into an authentication key (authKey) and an encryption key (vaultKey). Client credentials, secure notes, credit cards, and API keys are symmetrically encrypted client-side using authenticated AES-256-GCM with fresh 96-bit random IVs and Associated Authenticated Data (AAD) binding before transmission to the Express API server.")
    add_para("VaultGuard incorporates real-time password intelligence powered by zxcvbn-ts, calculating crack-time estimates, entropy, and actionable strength tips. It provides client-side in-memory reuse detection, weak and similar password identification, breach checking via HaveIBeenPwned k-anonymity (transmitting only 5-character SHA-1 prefixes), and an automated one-click Fix Wizard. To guarantee account accessibility without violating zero-knowledge principles, VaultGuard delivers robust Multi-Factor Authentication (TOTP authenticator app, 10 single-use backup codes, email OTP, and WebAuthn passkeys), cryptographically protected Secure Send sharing, and a client-side recovery key system with destructive reset safeguards.")
    add_para("VaultGuard provides full optimistic concurrency control with revision counters, client-side auto-lock, session revocation, comprehensive audit logging, and automated trash purging. The application achieves end-to-end data privacy, ensuring that even under total server compromise, unauthorized parties cannot decrypt stored user credentials.", bold_prefix=None)
    add_para("Zero-knowledge architecture, AES-256-GCM, PBKDF2, Web Crypto API, password intelligence, zxcvbn, multi-factor authentication, HIBP k-anonymity, secure credential vault.", bold_prefix="Keywords: ")

    doc.add_page_break()

    # ================= PAGE 5: ACKNOWLEDGEMENT =================
    add_heading_1("ACKNOWLEDGEMENT")
    add_para("We express our sincere gratitude to the Principal Dr. P. Deiva Sundari and the Management of our college for providing us with the opportunity to carry out this project work.")
    add_para("We convey our heartfelt thanks to the HEAD OF THE DEPARTMENT, [Dr. Ananthi. N], Department of INFORMATION TECHNOLOGY, for the continuous encouragement and support.")
    add_para("We are extremely thankful to our Project Guide, Ms. Grandhi Sai Lakshmi, Department of INFORMATION TECHNOLOGY for valuable guidance, suggestions, and motivation throughout the completion of this project.")
    add_para("We would also like to extend our gratitude to all the faculty members of the Department of INFORMATION TECHNOLOGY for their support.")
    add_para("Finally, we thank our parents and friends for their constant encouragement and help during the course of this project.")

    doc.add_page_break()

    # ================= PAGE 6: TABLE OF CONTENTS =================
    add_heading_1("TABLE OF CONTENTS")

    toc_table = doc.add_table(rows=1, cols=3)
    hdr_cells = toc_table.rows[0].cells
    hdr_cells[0].paragraphs[0].add_run("CHAPTER NO.")
    hdr_cells[1].paragraphs[0].add_run("TITLE")
    hdr_cells[2].paragraphs[0].add_run("PAGE No.")

    toc_data = [
        ("", "ABSTRACT", "4"),
        ("", "ACKNOWLEDGEMENT", "5"),
        ("", "TABLE OF CONTENTS", "6"),
        ("1", "INTRODUCTION", "7-9"),
        ("", "1.1 Overview", "7"),
        ("", "1.2 Problem Definition", "7"),
        ("", "1.3 Objective", "8"),
        ("", "1.4 Scope of the Project", "8"),
        ("", "1.5 Motivation", "9"),
        ("2", "RELATED WORK", "10-12"),
        ("", "2.1 Literature Review", "10"),
        ("", "2.2 Existing System", "11"),
        ("", "2.3 Proposed System", "11-12"),
        ("3", "SYSTEM ANALYSIS", "13-15"),
        ("", "3.1 System Requirements", "13"),
        ("", "3.2 Software and Hardware Requirements", "14-15"),
        ("4", "SYSTEM DESIGN", "16-20"),
        ("", "4.1 System Architecture", "16"),
        ("", "4.2 Module Description", "16-17"),
        ("", "4.3 Database Design", "17-18"),
        ("", "4.4 Class Diagram", "18-19"),
        ("", "4.5 Sequence Diagram", "19-20"),
        ("5", "IMPLEMENTATION", "21-23"),
        ("", "5.1 Implementation Overview", "21-22"),
        ("", "5.2 Key Functions (Code Explanation)", "22-23"),
        ("6", "CONCLUSION & FUTURE WORK", "24-25"),
        ("", "6.1 Conclusion", "24"),
        ("", "6.2 Future Enhancements", "24-25"),
        ("", "APPENDIX", "26"),
        ("", "SCREENSHOTS OF THE PROJECT", "41"),
        ("", "REFERENCES", "46")
    ]

    for cno, title, pno in toc_data:
        row_cells = toc_table.add_row().cells
        row_cells[0].paragraphs[0].add_run(cno)
        row_cells[1].paragraphs[0].add_run(title)
        row_cells[2].paragraphs[0].add_run(pno)
        row_cells[2].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
        if cno != "" or title in ["ABSTRACT", "ACKNOWLEDGEMENT", "TABLE OF CONTENTS", "APPENDIX", "SCREENSHOTS OF THE PROJECT", "REFERENCES"]:
            for cell in row_cells:
                for p in cell.paragraphs:
                    for r in p.runs:
                        r.bold = True

    format_table(toc_table, [1.2, 4.0, 1.0], headers=True)

    doc.add_page_break()

    # ================= CHAPTER 1: INTRODUCTION =================
    add_heading_1("CHAPTER 1\nINTRODUCTION")
    add_heading_2("1.1 OVERVIEW")
    add_para("Digital security in the modern era is fundamentally anchored to authentication credentials. Internet users interact daily with hundreds of software services across financial banking, medical records, enterprise portals, academic resources, and social networks. Each service requires unique, high-entropy secrets to safeguard sensitive user information against adversarial infiltration. However, the human cognitive architecture cannot reliably memorize dozens of long, distinct, and random character sequences. Consequently, users routinely adopt insecure operational habits: creating trivial, predictable passwords and reusing the exact same credentials across multiple unrelated domains.")
    add_para("VaultGuard – Zero-Knowledge Password Security and Credential Management Platform – is an enterprise-grade full-stack security application engineered as an Information Technology project. The system addresses this ubiquitous security crisis by combining client-side zero-knowledge cryptography with dynamic password intelligence and automated credential lifecycle management. Developed on the MERN stack (MongoDB, Express 5, React, Node.js), VaultGuard guarantees that all confidential user items—passwords, private notes, payment credit cards, and API secrets—are cryptographically encrypted and decrypted exclusively in the client browser's volatile memory using the Web Crypto API.")
    add_para("VaultGuard operates under a strict Zero-Knowledge Architecture. The master password never traverses the network and is never stored in server logs, databases, local web storage, or caching tiers. The Express REST API handles only opaque ciphertext blobs, cryptographically blind to the underlying payload. Furthermore, VaultGuard integrates real-time password strength scoring via zxcvbn, entropy crack-time calculations, automated credential reuse detection, breach verification through HaveIBeenPwned k-anonymity, multi-factor authentication, and end-to-end encrypted sharing via Secure Send.")

    add_heading_2("1.2 PROBLEM DEFINITION")
    add_para("Modern digital identity management is severely compromised by human memory limitations, weak credential habits, and flawed architectural designs in conventional web applications. When individuals manage credentials without zero-knowledge cryptographic safeguards, the following critical vulnerabilities emerge:")
    add_bullet("Human cognitive strain causes users to generate short, dictionary-based, or easily guessable passwords that succumb to automated dictionary and brute-force attacks within seconds.", "Weak Password Selection: ")
    add_bullet("Over 65% of internet users reuse identical or slightly modified passwords across several web platforms. A single security breach at an insecure third-party provider immediately exposes the user's high-value accounts (such as email and banking) to automated credential stuffing.", "Ubiquitous Credential Reuse: ")
    add_bullet("Many conventional password managers store decryption keys or plaintext records on centralized servers. A database compromise, malicious insider, or subpoena immediately exposes every stored credential to unauthorized inspection.", "Centralized Server Vulnerability: ")
    add_bullet("Users frequently share sensitive credentials, API keys, and temporary tokens through unencrypted channels such as chat apps, emails, and notes, creating permanent plaintext footprints across intermediate networks.", "Insecure Credential Sharing: ")
    add_bullet("Standard password recovery mechanisms rely entirely on trivial email reset links. If an attacker compromises a user's email inbox, they gain unrestricted access to reset and compromise every associated account without cryptographic challenge.", "Flawed Recovery Mechanisms: ")
    add_para("The problem addressed by this project is the imperative need for a unified, mathematically robust, zero-knowledge platform that secures user credentials client-side, continuously audits credential health, detects breach exposure, and enforces rigorous multi-factor authentication.")

    add_heading_2("1.3 OBJECTIVE")
    add_para("The primary objective of VaultGuard is to engineer and deploy a zero-knowledge password management and security auditing platform that guarantees total confidentiality while actively improving user authentication hygiene. The specific technical objectives are to:")
    add_bullet("Enforce client-side cryptographic key derivation using PBKDF2-SHA256 (600,000 rounds) and HKDF to derive separate authentication keys and vault encryption keys.", "Zero-Knowledge Encryption: ")
    add_bullet("Encrypt all user items (logins, secure notes, credit cards, API keys) using AES-256-GCM with fresh 96-bit random initialization vectors (IV) and Associated Authenticated Data (AAD) binding to eliminate tampering.", "Authenticated Vault Storage: ")
    add_bullet("Evaluate passwords in real time using the zxcvbn-ts algorithm, calculating Shannon entropy, crack-time estimates, and actionable improvement recommendations.", "Real-Time Password Intelligence: ")
    add_bullet("Identify duplicate, similar, and outdated credentials in-memory, computing an overarching Security Score (0–100) with an automated Fix Wizard.", "Credential Health Auditing: ")
    add_bullet("Implement client-side k-anonymity breach checking against the HaveIBeenPwned API by transmitting only the first 5 hexadecimal characters of the SHA-1 password hash.", "Breach Detection: ")
    add_bullet("Deliver robust multi-factor authentication support including RFC 6238 TOTP, 10 single-use hashed backup codes, email verification OTPs, and WebAuthn/FIDO2 passkeys.", "Comprehensive Multi-Factor Authentication: ")
    add_bullet("Enable ephemeral end-to-end encrypted sharing via Secure Send, utilizing cryptographic keys embedded solely in URL hash fragments to prevent server inspection.", "Zero-Knowledge Secure Send: ")
    add_bullet("Provide multi-tier account recovery using client-side generated recovery keys with destructive reset fallbacks to preserve zero-knowledge integrity.", "Cryptographic Recovery Safeguards: ")

    add_heading_2("1.4 SCOPE OF THE PROJECT")
    add_para("Within scope. A complete browser-based Single Page Application (React, Vite, Tailwind CSS) communicating with an Express 5 REST API backed by MongoDB. Client-side cryptographic operations via Web Crypto API (PBKDF2, HKDF, AES-256-GCM); client-side vault encryption, decryption, search, filtering, and sorting; optimistic concurrency control using revision counters; live password evaluation via zxcvbn-ts; HaveIBeenPwned k-anonymity breach verification; multi-factor authentication (TOTP, backup codes, email OTP, passkeys); client-side recovery key generation and verification; Secure Send zero-knowledge payload sharing; session management and security audit logging; automated 30-day trash cleanup via MongoDB TTL indexes; and comprehensive test suites running on node:test and vitest.")
    add_para("Outside scope. Native desktop or mobile OS applications; browser autofill extensions (targeted for separate client packaging); hardware security module (HSM) direct integration; enterprise Active Directory / LDAP synchronization; automated biological scanning; and server-side plaintext decryption. These deliberate architectural boundaries guarantee the absolute sanctity of the zero-knowledge model.")

    add_heading_2("1.5 MOTIVATION")
    add_para("The dramatic escalation in high-profile corporate data breaches highlights the fundamental flaw in traditional, server-trusted identity models. Storing user credentials on servers—even in hashed or centrally encrypted forms—creates an irresistible target for global threat actors. When server databases are leaked, millions of consumer identities are compromised simultaneously.")
    add_para("Zero-knowledge architecture shifts the trust paradigm entirely: by performing all encryption and decryption client-side in the browser's sandbox using standardized Web Crypto primitives, the cloud server is reduced to an untrusted ciphertext repository. Even if an attacker gains root administrative privileges over the database or server infrastructure, they obtain only opaque, cryptographically intractable ciphertext. Combining this mathematical protection with proactive credential health monitoring, breach detection, and MFA creates an indispensable, resilient defense for modern digital citizens.")

    doc.add_page_break()

    # ================= CHAPTER 2: RELATED WORK =================
    add_heading_1("CHAPTER 2\nRELATED WORK")
    add_heading_2("2.1 LITERATURE REVIEW")
    add_para("The foundational design of VaultGuard synthesizes established academic literature, cryptographic standards, and web application security architectures across three core domains: password strength estimation and cognitive security, zero-knowledge cryptographic models, and modern web application security frameworks.")
    
    add_heading_3("Password Strength Estimation and Cognitive Security")
    add_para("Traditional password composition policies (mandating combinations of uppercase, lowercase, numbers, and symbols) have been shown by Komanduri et al. [1] and NIST SP 800-63B [2] to degrade user security. Users adhere to naive rules by performing predictable substitutions (e.g., '@' for 'a') and appending single digits, leading to low entropy and high susceptibility to dictionary attacks. Wheeler [3] introduced zxcvbn, a realistic password strength estimator based on pattern matching and conservative entropy calculations against large dictionaries of popular passwords, common names, dates, and keyboard sequences. VaultGuard incorporates the modern TypeScript port, zxcvbn-ts, to provide accurate, real-time crack-time estimates and actionable feedback without transmitting keystrokes across the network.")

    add_heading_3("Zero-Knowledge Cryptographic Paradigms and Key Derivation")
    add_para("Zero-knowledge architecture dictates that secrets must never be exposed to intermediary transport layers or cloud servers. The National Institute of Standards and Technology (NIST) specifies the Password-Based Key Derivation Function 2 (PBKDF2) in SP 800-132 [4], establishing that high iteration counts (minimum 600,000 for SHA-256) effectively neutralize GPU-accelerated dictionary attacks. Krawczyk and Eronen [5] specified HKDF (HMAC-based Extract-and-Expand Key Derivation Function, RFC 5869), which VaultGuard applies to mathematically bifurcate derived key material into distinct authentication and encryption keys. Symmetrically, Dworkin [6] standardized Galois/Counter Mode (AES-256-GCM) in NIST SP 800-38D, guaranteeing both confidentiality and cryptographic integrity verification via Associated Authenticated Data (AAD).")

    add_heading_3("Authentication Security and Web Standards")
    add_para("Modern web security relies on multi-factor authentication (MFA) and k-anonymity privacy models. M'Raihi et al. [7] formulated the Time-Based One-Time Password (TOTP) algorithm in RFC 6238, which VaultGuard implements natively on the server using node:crypto HMAC without third-party dependencies. Hunt [8] demonstrated k-anonymity breach checking, enabling clients to query breached password databases by providing only a 5-character SHA-1 hash prefix, ensuring the complete hash and password remain entirely secret. Furthermore, Provos and Mazières [9] formulated bcrypt for adaptive password hashing, while Fielding [10] and Fowler [11] established REST architectural and enterprise application design principles.")

    add_para("Table of published standards and their architectural relevance to VaultGuard:")
    
    lit_table = doc.add_table(rows=1, cols=3)
    hdr = lit_table.rows[0].cells
    hdr[0].paragraphs[0].add_run("Source")
    hdr[1].paragraphs[0].add_run("Domain / Standard")
    hdr[2].paragraphs[0].add_run("Architectural Relevance to VaultGuard")

    lit_data = [
        ("NIST SP 800-63B [2]", "Digital Identity Guidelines", "Elimination of arbitrary character rules; guidance on password length and breach checks."),
        ("Wheeler [3]", "zxcvbn Password Estimator", "Client-side pattern-matching entropy calculation and crack-time estimation."),
        ("NIST SP 800-132 [4]", "PBKDF2 Specification", "600,000-iteration master key derivation preventing GPU-based brute force."),
        ("RFC 5869 (HKDF) [5]", "Key Derivation Function", "Cryptographic bifurcation into separate authKey and vaultKey primitives."),
        ("NIST SP 800-38D [6]", "AES-GCM Authenticated Encryption", "256-bit vault encryption with AAD binding to prevent tampering."),
        ("RFC 6238 (TOTP) [7]", "Time-Based One-Time Password", "Two-factor authentication using native HMAC-SHA1 without external libraries."),
        ("Hunt [8]", "HIBP k-Anonymity Model", "Zero-leakage breach detection sending only 5-character SHA-1 prefixes."),
        ("Provos & Mazières [9]", "bcrypt Password Hashing", "Server-side hashing of client authKey before database storage."),
        ("RFC 7519 (JWT) [12]", "JSON Web Token", "Stateless, digitally signed access tokens carrying user identity."),
        ("W3C WebAuthn [13]", "FIDO2 Web Authentication", "Hardware-backed biometric passkey authentication.")
    ]

    for src, dom, rel in lit_data:
        row = lit_table.add_row().cells
        row[0].paragraphs[0].add_run(src)
        row[1].paragraphs[0].add_run(dom)
        row[2].paragraphs[0].add_run(rel)

    format_table(lit_table, [1.5, 1.8, 2.9], headers=True)

    add_heading_2("2.2 EXISTING SYSTEM")
    add_para("In typical personal and commercial environments, credential management is fragmented across conventional, insecure mechanisms:")
    add_bullet("Users rely on cognitive memory, leading to simplistic, reusable passwords like 'Password123!' across multiple services.", "Human Cognitive Storage: ")
    add_bullet("Credentials saved in unencrypted spreadsheets, text files, or paper notes, completely exposed to local system intruders.", "Plaintext Digital Files: ")
    add_bullet("Standard web browsers offer built-in password management, but keys are frequently tied to operating system accounts or synchronized via proprietary cloud servers with weak master passphrases.", "Browser Autofill Stores: ")
    add_bullet("Legacy commercial password managers that utilize proprietary server-side encryption or closed-source codebases, leaving users vulnerable to undocumented telemetry, opaque key handling, and high subscription costs.", "Proprietary Cloud Managers: ")
    add_para("The critical limitations of existing approaches are: vulnerable server storage where database theft compromises all credentials; lack of automated breach detection; absence of mathematical tamper-proofing (AAD); and opaque recovery flows that bypass multi-factor verification.")

    add_heading_2("2.3 PROPOSED SYSTEM")
    add_para("The proposed platform, VaultGuard, replaces fragmented, server-trusted storage with a verifiable zero-knowledge web architecture built on Express 5, React, and MongoDB. Key features include:")
    add_bullet("Master passwords never leave the client browser. Cryptographic keys are derived locally using PBKDF2 (600,000 rounds) and HKDF.", "Client-Side Cryptographic Boundary: ")
    add_bullet("Items (logins, cards, secure notes, API keys) are encrypted using AES-256-GCM with fresh 96-bit random IVs and AAD binding (userId:itemId) before network transmission.", "Authenticated Vault Encryption: ")
    add_bullet("Real-time entropy and crack-time evaluation powered by zxcvbn-ts, with in-memory reuse detection and automated Fix Wizard recommendations.", "Password Intelligence & Fix Wizard: ")
    add_bullet("Zero-leakage breach checking using HaveIBeenPwned k-anonymity, transmitting only 5-character SHA-1 prefixes.", "k-Anonymity Breach Verification: ")
    add_bullet("RFC 6238 TOTP, 10 single-use hashed backup codes, email OTPs, and WebAuthn passkeys.", "Comprehensive Multi-Factor Authentication: ")
    add_bullet("Ephemeral sharing of secrets where the decryption key is located entirely in the URL hash fragment, completely hidden from the server.", "Zero-Knowledge Secure Send: ")

    add_para("Comparison between conventional credential management and VaultGuard:")
    
    comp_table = doc.add_table(rows=1, cols=3)
    hdr = comp_table.rows[0].cells
    hdr[0].paragraphs[0].add_run("Security Aspect")
    hdr[1].paragraphs[0].add_run("Conventional Password Stores")
    hdr[2].paragraphs[0].add_run("VaultGuard Zero-Knowledge Platform")

    comp_data = [
        ("Key Derivation Location", "Server-side or weak client-side hashing", "Client-side Web Crypto PBKDF2-SHA256 (600,000 iterations) + HKDF"),
        ("Server Knowledge", "Server has access to plaintext or master decryption keys", "Zero-Knowledge: Server stores only opaque AES-256-GCM ciphertext"),
        ("Tamper Detection", "Basic checksums or unauthenticated encryption", "AES-256-GCM with AAD binding (userId:itemId) guaranteeing integrity"),
        ("Password Intelligence", "Static regex rules (1 upper, 1 number)", "Real-time zxcvbn-ts entropy, crack time, reuse detection, and Security Score"),
        ("Breach Checking", "None or insecure transmission of plaintext/full hash", "k-Anonymity via HaveIBeenPwned (only 5-character SHA-1 prefix transmitted)"),
        ("Two-Factor Authentication", "SMS or optional authenticator", "Native RFC 6238 TOTP, 10 single-use backup codes, Email OTP, and WebAuthn passkeys"),
        ("Credential Sharing", "Plaintext email, chat messages, or cloud links", "Secure Send: End-to-end encrypted with key in URL hash fragment"),
        ("Session Inactivity", "Sessions persist indefinitely", "Client-side auto-lock timer zeroizing cryptographic keys in memory")
    ]

    for asp, conv, vg in comp_data:
        row = comp_table.add_row().cells
        row[0].paragraphs[0].add_run(asp)
        row[1].paragraphs[0].add_run(conv)
        row[2].paragraphs[0].add_run(vg)

    format_table(comp_table, [1.4, 2.4, 2.4], headers=True)

    doc.add_page_break()

    # ================= CHAPTER 3: SYSTEM ANALYSIS =================
    add_heading_1("CHAPTER 3\nSYSTEM ANALYSIS")
    add_heading_2("3.1 SYSTEM REQUIREMENTS")
    add_heading_3("3.1.1 Functional Requirements")
    add_bullet("The client application shall derive an authKey and a non-extractable vaultKey in browser memory using PBKDF2-SHA256 (600,000 iterations) and HKDF. The master password shall never be transmitted across the network.", "FR-1: Zero-Knowledge Key Derivation: ")
    add_bullet("Users shall register and authenticate using email and authKey. The server shall hash the received authKey using scrypt before storing it in MongoDB. The API shall reject disabled or unverified accounts.", "FR-2: Secure Authentication: ")
    add_bullet("All vault items (logins, secure notes, credit cards, API keys) shall be encrypted client-side using AES-256-GCM with a fresh 96-bit random IV and AAD bound to userId:itemId. Decryption shall occur strictly in browser memory.", "FR-3: Authenticated Vault CRUD: ")
    add_bullet("The client shall evaluate password strength using zxcvbn-ts, displaying Shannon entropy bits, crack-time estimates, and actionable tips. It shall calculate an aggregate Security Score (0–100) and identify duplicate, similar, and outdated credentials.", "FR-4: Password Intelligence Engine: ")
    add_bullet("The client shall query the HaveIBeenPwned API using k-anonymity (transmitting only the first 5 hexadecimal characters of the SHA-1 hash) to detect breached passwords without leaking credentials.", "FR-5: Breach Verification: ")
    add_bullet("The system shall support two-factor authentication via RFC 6238 TOTP with QR setup, 10 single-use SHA-256 hashed backup codes, email verification OTPs, and WebAuthn/FIDO2 passkeys.", "FR-6: Multi-Factor Authentication: ")
    add_bullet("The system shall generate a high-entropy client-side recovery key displayed once during onboarding. Account recovery shall require email token verification, MFA challenge, and recovery key unwrapping.", "FR-7: Account Recovery Safeguards: ")
    add_bullet("Users shall share encrypted secrets via ephemeral links with configurable view limits (e.g., 1 view) and TTL expiration. Decryption keys shall reside exclusively in the URL hash fragment.", "FR-8: Ephemeral Secure Send: ")
    add_bullet("The client shall automatically lock and purge memory-resident CryptoKeys upon tab closure, window reload, or configurable idle timeout (default 15 minutes).", "FR-9: Memory Zeroization & Auto-Lock: ")
    add_bullet("The system shall record comprehensive audit logs for sensitive events (login, failed MFA, password change, recovery, item deletion) and support remote session termination.", "FR-10: Audit Logging & Session Control: ")

    add_heading_3("3.1.2 Non-Functional Requirements")
    add_bullet("Cryptographic operations must strictly utilize standard implementations (Web Crypto API client-side, node:crypto server-side). Modulo bias, Math.random(), and plaintext transmission are strictly prohibited.", "Security & Cryptographic Integrity: ")
    add_bullet("The web interface must be fully responsive across desktop, tablet, and mobile devices, providing clear loading skeletons, empty states, and WCAG 2.2 AA compliant contrast.", "Usability & Accessibility: ")
    add_bullet("All incoming API parameters, query strings, and request bodies must be validated at the route boundary using Zod schemas, completely eliminating NoSQL injection vulnerabilities.", "Reliability & Input Validation: ")
    add_bullet("Client-side cryptographic operations (KDF derivation and batch decryption) must execute with visual feedback indicators and remain responsive. Initial bundle size must remain under 250 KB gzip.", "Performance & Responsiveness: ")
    add_bullet("Every MongoDB query must be explicitly scoped by the verified userId extracted from the digitally signed JWT token, mathematically preventing Insecure Direct Object References (IDOR).", "Authorization & Data Isolation: ")

    add_heading_2("3.2 SOFTWARE AND HARDWARE REQUIREMENTS")
    add_heading_3("Software Requirements")
    
    sw_table = doc.add_table(rows=1, cols=2)
    hdr = sw_table.rows[0].cells
    hdr[0].paragraphs[0].add_run("Component")
    hdr[1].paragraphs[0].add_run("Technology / Specification")

    sw_data = [
        ("Operating System", "Windows 10/11, macOS Sequoia, or modern Linux distribution (Ubuntu 22.04 LTS)"),
        ("Server Runtime", "Node.js (LTS release v20+) with npm / npx"),
        ("Backend Framework", "Express.js 5, Native ECMAScript Modules (ESM) with JSDoc"),
        ("Database Engine", "MongoDB (Local daemon or MongoDB Atlas) accessed via Mongoose"),
        ("Security Middleware", "Helmet, CORS, Express-Rate-Limit, Cookie-Parser, Zod validation"),
        ("Cryptographic Libraries", "Server: node:crypto (scrypt, HMAC, randomBytes, timingSafeEqual); Client: Web Crypto API"),
        ("Frontend Framework", "React 18, Vite, React Router 6, Tailwind CSS 3"),
        ("Password Intelligence", "@zxcvbn-ts/core, @zxcvbn-ts/language-common, @zxcvbn-ts/language-en"),
        ("Authentication Standards", "JSON Web Tokens (jsonwebtoken), @simplewebauthn/server & @simplewebauthn/browser"),
        ("Data Visualization & UI", "Recharts (data analytics), Lucide React (icons), qrcode.react, PapaParse"),
        ("Test Frameworks", "Server: node:test with node:assert/strict, mongodb-memory-server; Client: vitest")
    ]

    for comp, spec in sw_data:
        row = sw_table.add_row().cells
        row[0].paragraphs[0].add_run(comp)
        row[1].paragraphs[0].add_run(spec)

    format_table(sw_table, [2.0, 4.2], headers=True)

    add_heading_3("Hardware Requirements")
    
    hw_table = doc.add_table(rows=1, cols=2)
    hdr = hw_table.rows[0].cells
    hdr[0].paragraphs[0].add_run("Component")
    hdr[1].paragraphs[0].add_run("Minimum Specification (Recommended)")

    hw_data = [
        ("Processor", "Dual-core 2.0 GHz or higher (Recommended: Quad-core 2.5 GHz Intel Core i5/i7 or AMD Ryzen)"),
        ("RAM", "4 GB minimum (Recommended: 8 GB or 16 GB for simultaneous client/server dev)"),
        ("Storage", "2 GB free disk space for Node modules, repository, and MongoDB database files"),
        ("Network Interface", "Localhost operation requires none; remote HIBP checks and SMTP require broadband internet"),
        ("Display Resolution", "1366 × 768 minimum (Recommended: 1920 × 1080 full HD)"),
        ("Input Peripherals", "Standard keyboard and mouse / trackpad")
    ]

    for comp, spec in hw_data:
        row = hw_table.add_row().cells
        row[0].paragraphs[0].add_run(comp)
        row[1].paragraphs[0].add_run(spec)

    format_table(hw_table, [2.0, 4.2], headers=True)

    add_para("Actual development environment: The project was engineered, tested, and validated on an x64 workstation running Windows 11 with Node.js LTS, utilizing MongoDB local instance and modern Chromium/Gecko browsers.", bold_prefix=None)

    doc.add_page_break()

    # ================= CHAPTER 4: SYSTEM DESIGN =================
    add_heading_1("CHAPTER 4\nSYSTEM DESIGN")
    add_heading_2("4.1 SYSTEM ARCHITECTURE")
    add_para("VaultGuard follows a decoupled, three-tier zero-knowledge client–server architecture. The Presentation Layer is a responsive React Single Page Application (SPA) executed entirely inside the browser's JavaScript V8 engine. The browser layer encapsulates all sensitive key derivation and cryptographic operations using the W3C Web Crypto API standard. The Application Layer consists of an Express 5 REST API handling request routing, Zod schema validation, rate limiting, and business logic execution. The Data Layer is powered by MongoDB, persisting user profiles, encrypted vault blobs, audit trails, and ephemeral send items.")
    add_para("Figure 4.1 illustrates the structural data flow and cryptographic boundaries of VaultGuard. When a user authenticates, the client derives an authKey and a non-extractable vaultKey in volatile RAM. Only the authKey is sent over HTTPS to the API server, where it is verified against an scrypt hash. The vaultKey remains in browser memory to decrypt AES-256-GCM item payloads received from the server. Decrypted credentials, keys, and session tokens are strictly zeroized upon browser lock or tab disposal.")

    # Textual diagram representation
    add_code_block("Figure 4.1: VaultGuard Three-Tier Zero-Knowledge Architecture", "Architecture Diagram", 
"""┌───────────────────────────────── CLIENT BROWSER (React SPA) ─────────────────────────────────┐
│                                                                                             │
│  [React Pages & Components]  <--->  [Crypto Engine (Web Crypto API)]                        │
│  (Vault, Dashboard, Send)           - PBKDF2-SHA256 (600,000 rounds) -> authKey & vaultKey  │
│                                     - AES-256-GCM Client Decryption / Encryption (AAD)      │
│  [Intelligence & Auditing]          - Memory Only: vaultKey, plaintext credentials          │
│  - zxcvbn-ts Strength Engine                                                                │
│  - In-Memory Reuse Detector   --->  [HIBP k-Anonymity API (5-char SHA-1 prefix)]            │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ HTTPS REST API (/api/v1)
                                               │ (Ciphertext Only / No Master Password)
                                               ▼
┌───────────────────────────────────── EXPRESS 5 REST API ────────────────────────────────────┐
│                                                                                             │
│  [Security Boundary Middleware]                                                             │
│  - Helmet (CSP, HSTS)  |  CORS  |  Express-Rate-Limit (Lockout)  |  Zod Schema Validation   │
│                                                                                             │
│  [Route Controllers]                                                                        │
│  - authRoutes (scrypt hash, JWT)    - vaultRoutes (Encrypted CRUD, Revisions)               │
│  - mfaRoutes (TOTP, WebAuthn, OTP)  - sendRoutes (Atomic view limit, Ephemeral secrets)     │
│  - meRoutes (Sessions, Audit Log)   - crypto utility (node:crypto HMAC, AES-GCM server)     │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ Mongoose ODM / Driver
                                               ▼
┌─────────────────────────────────────── MONGODB DATABASE ────────────────────────────────────┐
│                                                                                             │
│  Collections:                                                                               │
│  - users (authKey scrypt hash, wrappedVaultKey, MFA secrets, recoveryVerifier)              │
│  - items (encryptedData, iv, aad, revision, folder, isFavorite, isTrash)                    │
│  - sends (encryptedPayload, viewLimit, viewsRemaining, expiresAt [TTL Index])               │
│  - sessions (refreshTokenHash, ip, userAgent, lastSeen)                                     │
│  - audits (userId, eventType, ipAddress, userAgent, timestamp)                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘""")

    add_heading_2("4.2 MODULE DESCRIPTION")
    
    mod_table = doc.add_table(rows=1, cols=2)
    hdr = mod_table.rows[0].cells
    hdr[0].paragraphs[0].add_run("Module")
    hdr[1].paragraphs[0].add_run("Architectural Role and Security Implementation")

    mod_data = [
        ("Zero-Knowledge Key Derivation", "Derives authKey and vaultKey client-side via PBKDF2-SHA256 (600,000 rounds) and HKDF. Ensures master password never traverses the network."),
        ("Authenticated Vault Management", "Manages logins, notes, cards, and API keys. Performs client-side AES-256-GCM encryption with 96-bit IVs and AAD binding (userId:itemId). Enforces optimistic concurrency via revision counters."),
        ("Password Intelligence & Fix Wizard", "Computes real-time entropy bits, crack times, and tips using zxcvbn-ts. Detects credential reuse and similar passwords in-memory. Calculates 0–100 Security Score and provides one-click strong replacements."),
        ("k-Anonymity Breach Verification", "Checks credentials against HaveIBeenPwned database by transmitting only 5-character SHA-1 prefixes, completely preserving credential anonymity."),
        ("Multi-Factor Authentication (MFA)", "Enforces multi-factor verification via native RFC 6238 TOTP (HMAC-SHA1), 10 single-use SHA-256 hashed backup codes, email OTPs, and WebAuthn/FIDO2 hardware passkeys."),
        ("Cryptographic Recovery System", "Generates client-side recovery keys displayed once at registration. Unwraps vaultKey upon email token verification and MFA challenge. Provides destructive reset fallback."),
        ("Ephemeral Secure Send", "Enables zero-knowledge sharing of passwords and notes. Decryption key is embedded solely in the URL hash fragment. Enforces atomic single-use view limits and MongoDB TTL expiration."),
        ("Session & Audit Management", "Tracks active device sessions with remote revocation. Records immutable audit trails for sensitive security events. Auto-locks vault upon inactivity.")
    ]

    for mname, mdesc in mod_data:
        row = mod_table.add_row().cells
        row[0].paragraphs[0].add_run(mname)
        row[1].paragraphs[0].add_run(mdesc)

    format_table(mod_table, [2.0, 4.2], headers=True)

    add_heading_2("4.3 DATABASE DESIGN")
    add_para("MongoDB stores application data across eight structured collections defined through Mongoose schemas. User data isolation is enforced at the database level by indexing and scoping all queries with verified user IDs.")
    
    db_table = doc.add_table(rows=1, cols=3)
    hdr = db_table.rows[0].cells
    hdr[0].paragraphs[0].add_run("Collection")
    hdr[1].paragraphs[0].add_run("Key Schema Fields")
    hdr[2].paragraphs[0].add_run("Indexes & Constraints")

    db_data = [
        ("users", "email, authKeyHash (scrypt), salt, wrappedVaultKey, recoveryVerifier, mfaConfig (totpSecret, backupCodes), isEmailVerified", "email (unique), createdAt"),
        ("items", "userId, folderId, type (login, note, card, api), encryptedData, iv, aad, revision, isFavorite, isTrash, deletedAt", "userId + isTrash, userId + folderId, deletedAt (TTL 30 days)"),
        ("folders", "userId, name, color, icon, createdAt", "userId + name (compound unique)"),
        ("sends", "userId, encryptedPayload, iv, maxViews, viewsCount, isPasswordProtected, passwordHash, expiresAt", "expiresAt (TTL index), id (unique)"),
        ("sessions", "userId, tokenHash (SHA-256), ipAddress, userAgent, lastActive, expiresAt", "tokenHash (unique), expiresAt (TTL index)"),
        ("audits", "userId, eventType, ipAddress, userAgent, metadata, timestamp", "userId + timestamp (descending)"),
        ("challenges", "userId, type (email_verify, pass_reset, step_up), tokenHash, attempts, expiresAt", "tokenHash (unique), expiresAt (TTL index)"),
        ("snapshots", "userId, encryptedBlob, iv, snapshotReason, createdAt", "userId + createdAt (descending)")
    ]

    for col, flds, idxs in db_data:
        row = db_table.add_row().cells
        row[0].paragraphs[0].add_run(col)
        row[1].paragraphs[0].add_run(flds)
        row[2].paragraphs[0].add_run(idxs)

    format_table(db_table, [1.3, 3.2, 1.7], headers=True)

    add_heading_2("4.4 CLASS DIAGRAM")
    add_para("Figure 4.2 outlines the primary data models and their relationship cardinalities in VaultGuard. A User maintains a 1-to-many relationship with Vault Items, Folders, Active Sessions, and Audit Logs. Items reference Folders optionally and belong strictly to a single User. Ephemeral Sends and Cryptographic Challenges maintain time-bounded lifetimes.")

    add_code_block("Figure 4.2: VaultGuard Data Model Relationship Diagram", "Class Relationship Specification",
"""┌──────────────────────────────────────┐          1..*  ┌──────────────────────────────────────┐
│                User                  │◄───────────────┤                Item                  │
├──────────────────────────────────────┤                ├──────────────────────────────────────┤
│ _id: ObjectId                        │                │ _id: ObjectId                        │
│ email: String (unique)               │                │ userId: ObjectId (FK -> User)        │
│ authKeyHash: String (scrypt)         │                │ folderId: ObjectId (FK -> Folder)    │
│ salt: String                         │                │ type: Enum (login, note, card, api)  │
│ wrappedVaultKey: String              │                │ encryptedData: String (AES-GCM)      │
│ recoveryVerifier: String             │                │ iv: String (96-bit random)           │
│ mfaConfig: Object                    │                │ aad: String (userId:itemId)          │
│ isEmailVerified: Boolean             │                │ revision: Number (concurrency)       │
└──────────────────┬───────────────────┘                │ isFavorite: Boolean                  │
                   │                                    │ isTrash: Boolean                     │
                   │ 1..*                               └──────────────────────────────────────┘
                   ├───────────────────┐ 1..*
                   ▼                   ▼
┌──────────────────────────────────────┐ ┌──────────────────────────────────────┐
│               Session                │ │              AuditLog                │
├──────────────────────────────────────┤ ├──────────────────────────────────────┤
│ _id: ObjectId                        │ │ _id: ObjectId                        │
│ userId: ObjectId (FK -> User)        │ │ userId: ObjectId (FK -> User)        │
│ tokenHash: String (SHA-256)          │ │ eventType: String                    │
│ userAgent: String                    │ │ ipAddress: String                    │
│ ipAddress: String                    │ │ timestamp: Date                      │
│ expiresAt: Date (TTL)                │ └──────────────────────────────────────┘
└──────────────────────────────────────┘""")

    add_heading_2("4.5 SEQUENCE DIAGRAM")
    add_para("Figure 4.3 models the zero-knowledge execution workflow for creating and encrypting a new vault item. The user enters credential details in the React interface; the client generates a fresh 96-bit IV, binds AAD, encrypts the payload using the browser's volatile vaultKey, and transmits only ciphertext to the API server.")

    add_code_block("Figure 4.3: Sequence Diagram – Encrypted Vault Item Creation", "Zero-Knowledge Flow",
"""[User]       [React Client]           [Web Crypto API]         [Express API]       [MongoDB]
   │                │                        │                       │                 │
   │──Enter Item───>│                        │                       │                 │
   │                │──deriveFreshIV()──────>│                       │                 │
   │                │<──96-bit random IV─────│                       │                 │
   │                │                        │                       │                 │
   │                │──encrypt(vaultKey, IV, payload, AAD)──────────>│                 │
   │                │<──ciphertext + authTag─│                       │                 │
   │                │                        │                       │                 │
   │                │──POST /api/v1/vault (Bearer JWT, ciphertext)──>│                 │
   │                │                        │                       │──Zod Validate──>│
   │                │                        │                       │──Scoped Save───>│
   │                │                        │                       │<──Saved Doc─────│
   │                │<──HTTP 201 Created (itemId, revision)──────────│                 │
   │<──Toast Alert──│                        │                       │                 │""")

    doc.add_page_break()

    # ================= CHAPTER 5: IMPLEMENTATION =================
    add_heading_1("CHAPTER 5\nIMPLEMENTATION")
    add_heading_2("5.1 IMPLEMENTATION OVERVIEW")
    add_para("The frontend is built with React 18 and Vite using Tailwind CSS for streamlined, modern styling, Lucide React for crisp interface iconography, and Recharts for security score analytics. Reusable components include KpiCard, StatusBadge, Modal, Toast, and ProtectedRoute. The client state is managed cleanly using React Context and hooks without heavy external state libraries.")
    add_para("The backend is built with Express 5 running natively on modern Node.js ECMAScript Modules (ESM) with JSDoc annotations. Routing is cleanly partitioned into dedicated modules: auth, vault, mfa, me, and send. Every endpoint enforces strict input validation using Zod schemas at the route boundary. MongoDB data persistence is managed through Mongoose models with unique indexes on emails, compound indexes on user-scoped items, and automated TTL indexes on expiring tokens and trash items.")

    api_table = doc.add_table(rows=1, cols=4)
    hdr = api_table.rows[0].cells
    hdr[0].paragraphs[0].add_run("Route Group")
    hdr[1].paragraphs[0].add_run("Methods")
    hdr[2].paragraphs[0].add_run("Authentication")
    hdr[3].paragraphs[0].add_run("Description & Security Scope")

    api_data = [
        ("/api/v1/auth", "POST", "Public / Step-Up", "Prelogin salt retrieval, registration, login, token refresh, and recovery verification."),
        ("/api/v1/vault", "GET, POST, PUT, DELETE", "Bearer JWT Required", "Encrypted CRUD operations for logins, notes, cards, and API keys with revision checks."),
        ("/api/v1/mfa", "GET, POST, DELETE", "Bearer JWT Required", "TOTP setup/validation, backup code verification, email OTP, and WebAuthn registration."),
        ("/api/v1/send", "GET, POST, DELETE", "Public / Auth", "Creation and retrieval of zero-knowledge ephemeral links with atomic view limits."),
        ("/api/v1/me", "GET, PUT, DELETE", "Bearer JWT Required", "Session listing, remote session revocation, audit log inspection, and account deletion.")
    ]

    for rg, meth, aut, desc in api_data:
        row = api_table.add_row().cells
        row[0].paragraphs[0].add_run(rg)
        row[1].paragraphs[0].add_run(meth)
        row[2].paragraphs[0].add_run(aut)
        row[3].paragraphs[0].add_run(desc)

    format_table(api_table, [1.4, 1.2, 1.4, 2.2], headers=True)

    add_heading_2("5.2 KEY FUNCTIONS (CODE EXPLANATION)")

    add_code_block("1. Client-Side Cryptographic Key Derivation", "client/src/lib/crypto.js",
"""export async function deriveKeys(masterPassword, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(masterPassword), "PBKDF2", false, ["deriveKey"]
  );
  // Derive intermediate master key using 600,000 PBKDF2-SHA256 iterations
  const masterKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 600000, hash: "SHA-256" },
    baseKey, { name: "HMAC", hash: "SHA-256", length: 256 }, true, ["sign"]
  );
  const masterRaw = await crypto.subtle.exportKey("raw", masterKey);
  // Bifurcate via HKDF into authKey and vaultKey
  const hkdfKey = await crypto.subtle.importKey("raw", masterRaw, "HKDF", false, ["deriveKey", "deriveBits"]);
  const authKeyBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("auth-salt"), info: enc.encode("authKey") },
    hkdfKey, 256
  );
  const vaultKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("vault-salt"), info: enc.encode("vaultKey") },
    hkdfKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
  return { authKey: bufferToHex(authKeyBits), vaultKey };
}""")

    add_code_block("2. Authenticated Item Encryption with AAD Binding", "client/src/lib/crypto.js",
"""export async function encryptItem(vaultKey, itemData, userId, itemId) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit CSPRNG IV
  const enc = new TextEncoder();
  const aad = enc.encode(`${userId}:${itemId}`); // Bind identity to prevent swap
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    vaultKey,
    enc.encode(JSON.stringify(itemData))
  );
  return {
    encryptedData: bufferToBase64(ciphertext),
    iv: bufferToBase64(iv),
    aad: `${userId}:${itemId}`
  };
}""")

    add_code_block("3. Server-Side Scrypt AuthKey Verification and Rate-Limited Login", "server/src/routes/auth.js",
"""export async function login(req, res) {
  const { email, authKey } = loginSchema.parse(req.body);
  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user || !user.isActive) {
    return res.status(401).json({ message: "Invalid credentials." });
  }
  // Constant-time scrypt verification of client authKey
  const keyBuffer = Buffer.from(authKey, "hex");
  const derivedHash = await scryptAsync(keyBuffer, user.salt, 32);
  if (!crypto.timingSafeEqual(Buffer.from(user.authKeyHash, "hex"), derivedHash)) {
    return res.status(401).json({ message: "Invalid credentials." });
  }
  if (user.mfaConfig?.enabled) {
    const sessionToken = generateMfaToken(user._id);
    return res.status(200).json({ mfaRequired: true, sessionToken });
  }
  const token = signJwt({ id: user._id, email: user.email });
  await writeAudit({ userId: user._id, action: "LOGIN", ip: req.ip });
  res.json({ token, wrappedVaultKey: user.wrappedVaultKey });
}""")

    add_code_block("4. Real-Time Password Intelligence and zxcvbn Scoring", "client/src/lib/strength.js",
"""import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
export function evaluatePassword(password) {
  if (!password) return { score: 0, crackTimeDisplay: "Instant", tips: [] };
  const result = zxcvbn(password);
  const entropy = Math.round(result.guesses_log10 * 3.322); // Shannon entropy bits
  return {
    score: result.score, // 0 to 4
    crackTime: result.crack_times_display.offline_slow_hashing_1e4_per_second,
    feedback: result.feedback.warning || "Strong password",
    suggestions: result.feedback.suggestions,
    entropyBits: entropy
  };
}""")

    add_code_block("5. Zero-Leakage HIBP k-Anonymity Breach Verification", "client/src/lib/hibp.js",
"""export async function checkBreach(password) {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5).toUpperCase();
  const suffix = hash.slice(5).toUpperCase();
  // Transmit strictly 5 hex characters to protect password confidentiality
  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  const text = await response.text();
  const lines = text.split("\\n");
  for (const line of lines) {
    const [h, count] = line.trim().split(":");
    if (h === suffix) return { breached: true, count: parseInt(count, 10) };
  }
  return { breached: false, count: 0 };
}""")

    add_code_block("6. Ephemeral Secure Send with Atomic View Limits", "server/src/routes/send.js",
"""export async function getSend(req, res) {
  const { id } = req.params;
  // Atomically decrement remaining views to enforce single-use limits
  const send = await Send.findOneAndUpdate(
    { _id: id, viewsRemaining: { $gt: 0 }, expiresAt: { $gt: new Date() } },
    { $inc: { viewsRemaining: -1 } },
    { new: true }
  );
  if (!send) return res.status(404).json({ message: "Link expired or unavailable." });
  if (send.viewsRemaining === 0) {
    await Send.deleteOne({ _id: id }); // Immediate cleanup upon exhaustion
  }
  res.json({ encryptedPayload: send.encryptedPayload, iv: send.iv });
}""")

    doc.add_page_break()

    # ================= CHAPTER 6: CONCLUSION & FUTURE WORK =================
    add_heading_1("CHAPTER 6\nCONCLUSION & FUTURE WORK")
    add_heading_2("6.1 CONCLUSION")
    add_para("VaultGuard successfully resolves the core dilemma between user convenience and high-assurance credential security. By implementing a strict Zero-Knowledge Architecture on the MERN stack, the platform ensures that sensitive authentication secrets, private notes, financial cards, and API tokens are encrypted and decrypted solely within the client's local execution context using standardized Web Crypto primitives.")
    add_para("The integration of real-time password intelligence (zxcvbn-ts), breach checking via HaveIBeenPwned k-anonymity, comprehensive multi-factor authentication (TOTP, backup codes, email OTP, and WebAuthn passkeys), and zero-knowledge ephemeral sharing (Secure Send) delivers an enterprise-grade defense against credential stuffing, brute force, and unauthorized database exfiltration. Even in the catastrophic event of a total server-side database leak, stored credentials remain cryptographically inviolable. VaultGuard satisfies all specified functional, architectural, and security objectives, providing an indispensable tool for personal and organizational digital protection.")

    add_heading_2("6.2 FUTURE ENHANCEMENTS")
    add_para("While VaultGuard delivers a comprehensive, production-ready credential management platform, several advanced capabilities are planned for future engineering phases:")
    add_bullet("Cross-browser extension packaging (Manifest V3) for Chrome, Firefox, and Safari to provide secure zero-knowledge credential autofill and inline password generation directly in web forms.", "Browser Autofill Extensions: ")
    add_bullet("Implementing progressive web application (PWA) standards with secure offline encrypted storage using IndexedDB and cryptographic synchronization.", "Installable Offline PWA: ")
    add_bullet("Engineering a zero-knowledge emergency contact protocol using Shamir's Secret Sharing (SLIP-0039) with configurable time-delay approval windows.", "Emergency Access Protocol: ")
    add_bullet("Secure multi-user vault sharing utilizing public-key cryptography (Web Crypto RSA-OAEP / ECDH) for enterprise team credential delegation.", "Cryptographic Team Vaults: ")
    add_bullet("Native integration with hardware security keys (YubiKey) for physical challenge-response vault unlocking and biometric enforcement.", "Hardware Security Token Integration: ")

    doc.add_page_break()

    # ================= APPENDIX: PROJECT SOURCE STRUCTURE & INSTALLATION =================
    add_heading_1("APPENDIX")
    add_heading_2("SOURCE CODE:")
    add_heading_3("1. Project Structure")
    add_para("Project Folder Structure:", bold_prefix=None)
    
    add_code_block("VaultGuard Directory Tree", "Repository Structure",
"""vaultguard/
├── server/
│   ├── src/
│   │   ├── config.js
│   │   ├── db.js
│   │   ├── logger.js
│   │   ├── middleware/ (auth.js, errorHandler.js, rateLimiter.js)
│   │   ├── models/ (User.js, Item.js, Folder.js, Send.js, Session.js, Audit.js, Challenge.js)
│   │   ├── routes/ (auth.js, vault.js, mfa.js, send.js, me.js)
│   │   ├── app.js
│   │   └── server.js
│   └── .env.example package.json
├── client/
│   ├── src/
│   │   ├── components/ (KpiCard, StatusBadge, Modal, Toast, ProtectedRoute, StrengthMeter)
│   │   ├── context/ (AuthContext.jsx, VaultContext.jsx)
│   │   ├── hooks/ (useApi.js, useIdleTimer.js)
│   │   ├── lib/ (crypto.js, strength.js, hibp.js, generator.js, score.js, import.js)
│   │   ├── pages/ (Login.jsx, Register.jsx, Dashboard.jsx, Vault.jsx, SecurityCenter.jsx,
│   │   │           Generator.jsx, Send.jsx, SendView.jsx, Settings.jsx, Recover.jsx)
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── .env.example package.json vite.config.js tailwind.config.js
└── README.md PRD.md SRS.md""")

    add_heading_3("2. Backend Package Installation")
    add_code_block("Server Setup Instructions", "Terminal Commands",
"""cd vaultguard/server
cp .env.example .env    # Configure PORT, MONGODB_URI, JWT_SECRET, CLIENT_ORIGIN
npm install             # Install express 5, mongoose, zod, jsonwebtoken, helmet, cors
npm test                # Run security and route verification tests (node:test)
npm run dev             # Start API daemon on http://localhost:5000

cd ../client
cp .env.example .env    # Configure VITE_API_URL
npm install             # Install react, vite, tailwindcss, @zxcvbn-ts/core, recharts
npm run dev             # Start frontend client on http://localhost:5173""")

    add_heading_3("3. Database Connection")
    add_code_block("MongoDB Connection Configuration", "server/src/db.js",
"""import mongoose from "mongoose";
export async function connectDB() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/vaultguard";
  try {
    await mongoose.connect(uri);
    console.log(`[VaultGuard] Connected to MongoDB -> ${uri}`);
  } catch (err) {
    console.error("[VaultGuard] MongoDB Connection Error:", err);
    process.exit(1);
  }
}""")

    add_heading_3("4. Environment Variables")
    add_para("Server environment (.env): PORT, MONGODB_URI, JWT_SECRET, JWT_EXPIRES_IN, CLIENT_ORIGIN, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.")
    add_para("Client environment (.env): VITE_API_URL, VITE_HIBP_ENABLED.")

    add_heading_3("5. User Data Model")
    add_code_block("User Mongoose Schema", "server/src/models/User.js",
"""import mongoose from "mongoose";
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  authKeyHash: { type: String, required: true },
  salt: { type: String, required: true },
  wrappedVaultKey: { type: String, required: true },
  recoveryVerifier: { type: String, required: true },
  mfaConfig: {
    totpEnabled: { type: Boolean, default: false },
    totpSecret: { type: String },
    backupCodes: [{ codeHash: String, used: Boolean }],
    passkeys: [{ credentialId: String, publicKey: String, counter: Number }]
  },
  isEmailVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
export default mongoose.model("User", UserSchema);""")

    add_heading_3("6. Encrypted Vault Item Model")
    add_code_block("Vault Item Mongoose Schema", "server/src/models/Item.js",
"""import mongoose from "mongoose";
const ItemSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: "Folder", default: null },
  type: { type: String, enum: ["login", "note", "card", "api"], required: true },
  encryptedData: { type: String, required: true },
  iv: { type: String, required: true },
  aad: { type: String, required: true },
  revision: { type: Number, default: 1 },
  isFavorite: { type: Boolean, default: false },
  isTrash: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null, index: { expires: "30d" } }
}, { timestamps: true });
export default mongoose.model("Item", ItemSchema);""")

    add_heading_3("7. Ephemeral Send Sharing Model")
    add_code_block("Send Mongoose Schema with TTL Index", "server/src/models/Send.js",
"""import mongoose from "mongoose";
const SendSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  encryptedPayload: { type: String, required: true },
  iv: { type: String, required: true },
  viewsRemaining: { type: Number, default: 1 },
  maxViews: { type: Number, default: 1 },
  isPasswordProtected: { type: Boolean, default: false },
  passwordHash: { type: String, default: null },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true });
export default mongoose.model("Send", SendSchema);""")

    doc.add_page_break()

    # ================= SCREENSHOTS & REFERENCES =================
    add_heading_1("SCREENSHOTS OF THE PROJECT")
    
    screenshots_data = [
        ("Figure A.1 Zero-Knowledge Authentication Page (Login / Register)", "Clean, modern glassmorphic interface with client-side key derivation progress indicator."),
        ("Figure A.2 Encrypted Credential Vault View", "Item list with type indicators (Logins, Cards, Notes, API Keys), search, folders, and favorites."),
        ("Figure A.3 Password Security Center & Health Audit", "Aggregate Security Score (0–100), crack-time analysis, reused password detector, and Fix Wizard."),
        ("Figure A.4 High-Entropy Password & Passphrase Generator", "Customizable length, character sets, separator symbols, and real-time entropy calculation."),
        ("Figure A.5 HaveIBeenPwned k-Anonymity Breach Verification", "Real-time breach audit interface transmitting only 5-character SHA-1 prefixes."),
        ("Figure A.6 Ephemeral Secure Send Management", "Creation of one-time self-destructing links with key embedded exclusively in URL hash."),
        ("Figure A.7 Multi-Factor Authentication Configuration", "RFC 6238 TOTP QR setup, single-use backup code generator, and WebAuthn passkey management."),
        ("Figure A.8 Security Audit Log & Active Session Management", "Immutable event history with IP, user agent, timestamp, and remote session revocation.")
    ]

    for title, desc in screenshots_data:
        add_heading_3(title)
        add_para(desc)
        # Visual placeholder box representing screenshot layout
        p_box = doc.add_paragraph()
        p_box.alignment = WD_ALIGN_PARAGRAPH.CENTER
        tbl_box = doc.add_table(rows=1, cols=1)
        tbl_box.alignment = WD_TABLE_ALIGNMENT.CENTER
        c_box = tbl_box.cell(0, 0)
        c_box.width = Inches(5.8)
        set_cell_margins(c_box, top=400, bottom=400, left=200, right=200)
        tcPr = c_box._tc.get_or_add_tcPr()
        tcPr.append(parse_xml(f'<w:shd {nsdecls("w")} w:fill="F1F5F9"/>'))
        tcPr.append(parse_xml(
            f'<w:tcBorders {nsdecls("w")}>'
            f'<w:top w:val="dashed" w:sz="6" w:space="0" w:color="94A3B8"/>'
            f'<w:left w:val="dashed" w:sz="6" w:space="0" w:color="94A3B8"/>'
            f'<w:bottom w:val="dashed" w:sz="6" w:space="0" w:color="94A3B8"/>'
            f'<w:right w:val="dashed" w:sz="6" w:space="0" w:color="94A3B8"/>'
            f'</w:tcBorders>'
        ))
        p_inner = c_box.paragraphs[0]
        p_inner.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r_inner = p_inner.add_run(f"[{title} – UI Artifact]")
        r_inner.font.name = 'Times New Roman'
        r_inner.font.size = Pt(10)
        r_inner.italic = True
        r_inner.font.color.rgb = RGBColor(100, 116, 139)

    doc.add_page_break()

    # ================= REFERENCES =================
    add_heading_1("REFERENCES")

    references_list = [
        "[1] S. Komanduri, R. Shay, P. G. Kelley, M. L. Mazurek, L. Bauer, N. Christin, L. F. Cranor, and S. Egelman, “Of passwords and people: Measuring the effect of password-composition policies,” in Proceedings of the SIGCHI Conference on Human Factors in Computing Systems, pp. 2595–2604, 2011.",
        "[2] P. A. Grassi, M. E. Garcia, and J. L. Fenton, “Digital Identity Guidelines: Authentication and Lifecycle Management,” NIST Special Publication 800-63B, National Institute of Standards and Technology, Gaithersburg, MD, 2020.",
        "[3] D. Wheeler, “zxcvbn: Realistic password strength estimation,” USENIX Association, 2016. [Online]. Available: https://github.com/dropbox/zxcvbn",
        "[4] M. J. Dworkin, “Recommendation for Password-Based Key Derivation: Part 1: Storage Applications,” NIST Special Publication 800-132, National Institute of Standards and Technology, 2010.",
        "[5] H. Krawczyk and P. Eronen, “HMAC-based Extract-and-Expand Key Derivation Function (HKDF),” RFC 5869, Internet Engineering Task Force, May 2010.",
        "[6] M. Dworkin, “Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM) and GMAC,” NIST Special Publication 800-38D, National Institute of Standards and Technology, 2007.",
        "[7] D. M'Raihi, S. Machani, M. Pei, and J. Rydell, “TOTP: Time-Based One-Time Password Algorithm,” RFC 6238, Internet Engineering Task Force, May 2011.",
        "[8] T. Hunt, “Have I Been Pwned: Pwned Passwords and k-Anonymity,” Troy Hunt Security Blog, 2018. [Online]. Available: https://www.troyhunt.com/ive-just-launched-pwned-passwords-version-2/",
        "[9] N. Provos and D. Mazières, “A Future-Adaptable Password Scheme,” in Proceedings of the USENIX Annual Technical Conference (FREENIX Track), pp. 81–91, 1999.",
        "[10] R. T. Fielding, “Architectural Styles and the Design of Network-based Software Architectures,” Ph.D. dissertation, University of California, Irvine, 2000.",
        "[11] M. Fowler, Patterns of Enterprise Application Architecture. Boston, MA: Addison-Wesley, 2002.",
        "[12] M. Jones, J. Bradley, and N. Sakimura, “JSON Web Token (JWT),” RFC 7519, Internet Engineering Task Force, May 2015.",
        "[13] W3C Web Authentication Working Group, “Web Authentication: An API for accessing Public Key Credentials Level 2,” W3C Recommendation, 2021. [Online]. Available: https://www.w3.org/TR/webauthn-2/",
        "[14] OWASP Foundation, “Password Storage Cheat Sheet,” OWASP Cheat Sheet Series, 2023. [Online]. Available: https://cheatsheetseries.owasp.org",
        "[15] MongoDB, Inc., “MongoDB Manual and Query Architecture,” 2024. [Online]. Available: https://www.mongodb.com/docs/manual/",
        "[16] W3C Web Cryptography Working Group, “Web Cryptography API,” W3C Recommendation, 2017. [Online]. Available: https://www.w3.org/TR/WebCryptoAPI/",
        "[17] I. Sommerville, Software Engineering, 10th ed. Harlow, England: Pearson, 2016."
    ]

    for ref in references_list:
        p_ref = doc.add_paragraph()
        p_ref.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        p_ref.paragraph_format.line_spacing = 1.5
        p_ref.paragraph_format.space_after = Pt(6)
        r_ref = p_ref.add_run(ref)
        r_ref.font.name = 'Times New Roman'
        r_ref.font.size = Pt(11)

    # Save to workspace root
    base_dir = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.join(base_dir, "VaultGuard_Project_Report.docx")
    doc.save(out_path)
    print(f"Report generated successfully at: {out_path}")

if __name__ == "__main__":
    create_vaultguard_report()
