"""
reference_data.py
Static code tables and reference entities used by the settlement data generator.
Everything here is synthetic. Company names are invented or generic.
"""

# ---------------------------------------------------------------- countries
# code, alpha3, numeric, region, currency, currency_num, tz_offset
COUNTRIES = [
    ("US", "USA", "840", "NA",   "USD", "840", -6),
    ("CA", "CAN", "124", "NA",   "CAD", "124", -5),
    ("MX", "MEX", "484", "LAC",  "MXN", "484", -6),
    ("BR", "BRA", "076", "LAC",  "BRL", "986", -3),
    ("GB", "GBR", "826", "EU",   "GBP", "826",  0),
    ("DE", "DEU", "276", "EU",   "EUR", "978",  1),
    ("FR", "FRA", "250", "EU",   "EUR", "978",  1),
    ("ES", "ESP", "724", "EU",   "EUR", "978",  1),
    ("IT", "ITA", "380", "EU",   "EUR", "978",  1),
    ("NL", "NLD", "528", "EU",   "EUR", "978",  1),
    ("IE", "IRL", "372", "EU",   "EUR", "978",  0),
    ("MT", "MLT", "470", "EU",   "EUR", "978",  1),
    ("CY", "CYP", "196", "EU",   "EUR", "978",  2),
    ("CW", "CUW", "531", "LAC",  "USD", "840", -4),
    ("PA", "PAN", "591", "LAC",  "USD", "840", -5),
    ("AE", "ARE", "784", "CEMEA","AED", "784",  4),
    ("SG", "SGP", "702", "AP",   "SGD", "702",  8),
    ("HK", "HKG", "344", "AP",   "HKD", "344",  8),
    ("PH", "PHL", "608", "AP",   "PHP", "608",  8),
    ("IN", "IND", "356", "AP",   "INR", "356",  5),
    ("AU", "AUS", "036", "AP",   "AUD", "036", 10),
    ("JP", "JPN", "392", "AP",   "JPY", "392",  9),
]

COUNTRY_BY_CODE = {c[0]: c for c in COUNTRIES}

# Countries that read as offshore / higher-integrity-risk acquiring domiciles
OFFSHORE_ACQ = ["CW", "MT", "CY", "PA", "AE", "PH"]

# ---------------------------------------------------------------- MCC table
# mcc, description, group, typical_avg_ticket, cnp_share, night_share, risk_class
MCC_TABLE = {
    "5812": ("Eating Places and Restaurants",        "Retail F&B",     46.0, 0.18, 0.14, "low"),
    "5814": ("Fast Food Restaurants",                "Retail F&B",     17.0, 0.22, 0.11, "low"),
    "5411": ("Grocery Stores, Supermarkets",         "Retail Staples", 68.0, 0.09, 0.05, "low"),
    "5541": ("Service Stations",                     "Retail Fuel",    42.0, 0.03, 0.10, "low"),
    "5651": ("Family Clothing Stores",               "Retail Apparel", 74.0, 0.35, 0.09, "low"),
    "5691": ("Men's and Women's Clothing Stores",    "Retail Apparel", 96.0, 0.40, 0.09, "low"),
    "5732": ("Electronics Stores",                   "Retail Durable", 210.0, 0.45, 0.10, "medium"),
    "5734": ("Computer Software Stores",             "Digital",        58.0, 0.92, 0.20, "medium"),
    "5735": ("Record Stores",                        "Digital",        22.0, 0.88, 0.18, "low"),
    "5999": ("Misc. and Specialty Retail Stores",    "Retail Other",   87.0, 0.55, 0.14, "medium"),
    "5399": ("Misc. General Merchandise",            "Retail Other",   64.0, 0.48, 0.13, "medium"),
    "5261": ("Lawn and Garden Supply Stores",        "Retail Home",    112.0, 0.20, 0.06, "low"),
    "5200": ("Home Supply Warehouse Stores",         "Retail Home",    128.0, 0.22, 0.07, "low"),
    "7011": ("Lodging - Hotels, Motels, Resorts",    "Travel",         320.0, 0.72, 0.12, "low"),
    "4511": ("Airlines and Air Carriers",            "Travel",         410.0, 0.90, 0.14, "low"),
    "4722": ("Travel Agencies and Tour Operators",   "Travel",         640.0, 0.86, 0.13, "medium"),
    "4121": ("Taxicabs and Limousines",              "Transport",      24.0, 0.80, 0.28, "low"),
    "7230": ("Beauty and Barber Shops",              "Services",       58.0, 0.10, 0.06, "low"),
    "7299": ("Other Services",                       "Services",       95.0, 0.62, 0.18, "medium"),
    "7392": ("Consulting, Management, PR Services",  "Services",       480.0, 0.75, 0.14, "medium"),
    "8999": ("Professional Services",                "Services",       350.0, 0.78, 0.15, "medium"),
    "5967": ("Direct Marketing - Inbound Teleservices","Direct Mktg",   52.0, 0.97, 0.30, "high"),
    "5966": ("Direct Marketing - Outbound Telemarketing","Direct Mktg", 78.0, 0.97, 0.26, "high"),
    "5968": ("Direct Marketing - Continuity/Subscription","Direct Mktg",39.0, 0.98, 0.24, "high"),
    "5969": ("Direct Marketing - Other",             "Direct Mktg",    66.0, 0.97, 0.25, "high"),
    "7995": ("Betting, Casino Gaming, Lottery",      "Gambling",       118.0, 0.90, 0.42, "high"),
    "7994": ("Video Game Arcades",                   "Gaming",         28.0, 0.70, 0.30, "medium"),
    "7841": ("Video Tape Rental / Adult Content",    "Adult",          34.0, 0.96, 0.38, "high"),
    "5122": ("Drugs, Drug Proprietors, Druggists",   "Pharma",         88.0, 0.72, 0.20, "high"),
    "5912": ("Drug Stores and Pharmacies",           "Pharma",         46.0, 0.28, 0.12, "medium"),
    "5993": ("Cigar Stores and Stands",              "Tobacco",        44.0, 0.40, 0.20, "high"),
    "5921": ("Package Stores - Beer, Wine, Liquor",  "Alcohol",        58.0, 0.25, 0.22, "medium"),
    "6051": ("Quasi-Cash - Non-FI, Crypto, FX",      "Quasi-Cash",     540.0, 0.94, 0.34, "high"),
    "6012": ("Financial Institutions - Merchandise", "Financial",      260.0, 0.85, 0.25, "high"),
    "6010": ("Financial Institutions - Manual Cash", "Financial",      420.0, 0.10, 0.20, "high"),
    "6211": ("Security Brokers and Dealers",         "Financial",      780.0, 0.93, 0.22, "high"),
    "7273": ("Dating and Escort Services",           "Adult",          62.0, 0.97, 0.44, "high"),
    "5960": ("Direct Marketing - Insurance Services","Direct Mktg",    145.0, 0.95, 0.18, "medium"),
    "8398": ("Charitable and Social Service Orgs",   "Nonprofit",      75.0, 0.90, 0.20, "medium"),
    "5816": ("Digital Goods - Games",                "Digital",        26.0, 0.99, 0.32, "medium"),
    "5815": ("Digital Goods - Media, Books, Movies", "Digital",        18.0, 0.99, 0.28, "medium"),
    "5817": ("Digital Goods - Applications",         "Digital",        14.0, 0.99, 0.30, "medium"),
    "4816": ("Computer Network / Information Services","Digital",      64.0, 0.97, 0.26, "medium"),
    "4899": ("Cable, Satellite, Pay TV",             "Digital",        82.0, 0.96, 0.16, "low"),
    "8062": ("Hospitals",                            "Healthcare",     640.0, 0.40, 0.18, "low"),
    "8011": ("Doctors and Physicians",               "Healthcare",     185.0, 0.35, 0.10, "low"),
    "5045": ("Computers, Peripherals, Software",     "Wholesale",      380.0, 0.60, 0.12, "medium"),
    "5094": ("Precious Stones, Metals, Jewelry",     "Jewelry",        920.0, 0.55, 0.15, "high"),
    "5944": ("Jewelry, Watches, Silverware Stores",  "Jewelry",        460.0, 0.42, 0.13, "medium"),
    "7999": ("Recreation Services",                  "Gaming",         38.0, 0.66, 0.24, "medium"),
    "7011x": ("", "", 0, 0, 0, "low"),  # placeholder guard
}
MCC_TABLE.pop("7011x")

# Prohibited / high-brand-risk categories that the model scores against
INTEGRITY_CATEGORIES = {
    "gambling":      ["7995", "7994"],
    "adult":         ["7841", "7273"],
    "dating_escort": ["7273", "7841"],
    "pharma":        ["5122", "5912"],
    "crypto_cash":   ["6051", "6010", "6012", "6211"],
    "cyberlocker":   ["5815", "5816", "5817", "4816"],
    "game_of_skill": ["7994", "7995", "7999"],
    "nutra_subscription": ["5967", "5966", "5968", "5969"],
    "tobacco_vape":  ["5993"],
    "financial_trading": ["6211", "6012"],
    "telemarketing": ["5966", "5967", "5969"],
}

# ---------------------------------------------------------------- issuers
# name, country, bin_prefix, product_mix
ISSUERS = [
    ("Northbay Federal Bank",        "US", "414720", 0.075),
    ("Great Lakes Card Services",    "US", "426398", 0.070),
    ("Pinehurst National",           "US", "440066", 0.060),
    ("Cascade Trust Bank",           "US", "451281", 0.055),
    ("Meridian One Financial",       "US", "471629", 0.050),
    ("Sunbelt Credit Union",         "US", "483102", 0.045),
    ("Harborline Bank",              "US", "492207", 0.040),
    ("Copperfield Savings",          "US", "400344", 0.035),
    ("Redwood Community CU",         "US", "446291", 0.030),
    ("Atlantic Seaboard Bank",       "US", "465873", 0.030),
    ("Maple Ridge Bank",             "CA", "450140", 0.030),
    ("Banco del Norte",              "MX", "455703", 0.025),
    ("Banco Aurora",                 "BR", "438921", 0.025),
    ("Thames Union Bank",            "GB", "465901", 0.035),
    ("Kingsway Retail Bank",         "GB", "475173", 0.025),
    ("Rheinland Sparbank",           "DE", "479955", 0.025),
    ("Banque Lumiere",               "FR", "497010", 0.020),
    ("Banco Ibérica",                "ES", "454630", 0.018),
    ("Nord Handelsbank",             "NL", "409752", 0.015),
    ("Emirates Gulf Bank",           "AE", "418850", 0.015),
    ("Straits Commercial Bank",      "SG", "462201", 0.020),
    ("Pearl Harbour Bank",           "HK", "440891", 0.015),
    ("Bharat Retail Bank",           "IN", "462901", 0.030),
    ("Deccan Payments Bank",         "IN", "489372", 0.020),
    ("Southern Cross Bank",          "AU", "450628", 0.018),
    ("Kanto Shinyo Bank",            "JP", "454328", 0.015),
    ("Pacific Isles Bank",           "PH", "455406", 0.012),
    ("Valletta Merchant Bank",       "MT", "489501", 0.008),
    ("Curacao International Bank",   "CW", "428820", 0.007),
    ("Nicosia Commercial",           "CY", "471033", 0.007),
]

# ---------------------------------------------------------------- acquirers
# name, country, acq_bin_list, profile ('bank','psp','offshore','payfac')
ACQUIRERS = [
    ("Vantage Merchant Services",   "US", ["401120", "401121"], "bank"),
    ("Crestline Acquiring Bank",    "US", ["402455"],           "bank"),
    ("Redstone Payments",           "US", ["403880", "403881"], "psp"),
    ("Union Bay Commerce",          "US", ["404912"],           "bank"),
    ("PayForge Solutions",          "US", ["405677"],           "payfac"),
    ("StreamPay Technologies",      "US", ["406203"],           "payfac"),
    ("Northgate Card Services",     "CA", ["407411"],           "bank"),
    ("Iberia Comercio Pagos",       "ES", ["408533"],           "bank"),
    ("Rhein Acquiring GmbH",        "DE", ["409144"],           "bank"),
    ("Albion Merchant Bank",        "GB", ["410288"],           "bank"),
    ("Valletta Payment Partners",   "MT", ["411905"],           "offshore"),
    ("Willemstad Commerce NV",      "CW", ["412677"],           "offshore"),
    ("Nicosia Acquiring Ltd",       "CY", ["413044"],           "offshore"),
    ("Gulf Merchant Acquiring",     "AE", ["414600"],           "offshore"),
    ("Isla Pagos Panama",           "PA", ["415233"],           "offshore"),
    ("Pacific Rim Payments",        "SG", ["416877"],           "psp"),
    ("Archipelago Payment Co",      "PH", ["417401"],           "offshore"),
    ("Bharat Acquiring Ltd",        "IN", ["418930"],           "bank"),
]

# ---------------------------------------------------------------- code tables
POS_ENTRY_MODES = {
    "01": "Manual / key entered",
    "02": "Magnetic stripe read, track data not reliable",
    "05": "Chip (EMV) contact read",
    "07": "Contactless chip",
    "10": "Credential on file",
    "80": "Chip fallback to magnetic stripe",
    "81": "Electronic commerce (e-commerce)",
    "90": "Magnetic stripe read, full track data",
    "91": "Contactless magnetic stripe",
}

POS_CONDITION_CODES = {
    "00": "Normal - cardholder present, card present",
    "01": "Cardholder not present, unspecified",
    "02": "Recurring / installment transaction",
    "03": "Merchant suspicious",
    "05": "Cardholder present, card not present",
    "08": "Mail / telephone order",
    "59": "Electronic commerce order",
    "71": "Cardholder identity verified by PIN",
}

TRANSACTION_TYPES = {
    "00": "Purchase / goods and services",
    "01": "Cash disbursement / cash advance",
    "09": "Purchase with cashback",
    "11": "Quasi-cash",
    "20": "Credit / refund",
    "22": "Reversal",
}

AUTH_RESPONSE_CODES = {
    "00": ("Approved", True),
    "10": ("Partial approval", True),
    "05": ("Do not honor", False),
    "51": ("Insufficient funds", False),
    "14": ("Invalid account number", False),
    "54": ("Expired card", False),
    "57": ("Transaction not permitted to cardholder", False),
    "58": ("Transaction not permitted to terminal", False),
    "59": ("Suspected fraud", False),
    "61": ("Exceeds withdrawal amount limit", False),
    "62": ("Restricted card", False),
    "65": ("Exceeds withdrawal frequency limit", False),
    "91": ("Issuer unavailable", False),
    "93": ("Transaction cannot be completed - violation of law", False),
    "N7": ("Decline for CVV2 failure", False),
}

CVV2_RESULTS = ["M", "N", "P", "S", "U", ""]      # match, no-match, not processed, not present, unavailable
AVS_RESULTS  = ["Y", "A", "Z", "N", "U", "R", ""]  # full, addr only, zip only, no match, unavailable, retry

ECI_VALUES = {
    "05": "3DS fully authenticated",
    "06": "3DS attempted, issuer not participating",
    "07": "3DS not attempted / SSL only",
    "":   "Not applicable",
}

INTERCHANGE_DESIGNATORS = ["A", "B", "C", "E", "N", "P", "R", "S", "U", "Z"]

# Base interchange rate (basis points of settled volume) that a merchant PAYS,
# keyed to the MCC group it is coded under. This is what makes MCC-abuse detectable:
# a merchant billed at the grocery/fuel/charity rate while behaving like a digital or
# direct-marketing business is paying 90-150 bps less than its real category warrants.
# The category the merchant *declares* sets the rate, which is exactly the lever abused.
# Rates are directional and synthetic, loosely reflecting real regulated-vs-standard
# vs high-risk spreads; they are not any network's published schedule.
INTERCHANGE_BPS_BY_GROUP = {
    "Healthcare":      160,
    "Wholesale":       185,
    "Jewelry":         205,
    "Retail Fuel":     115,   # capped / regulated — the cheapest legitimate homes
    "Retail Staples":  130,   # grocery — regulated debit-heavy
    "Nonprofit":       140,   # charitable rate concessions
    "Alcohol":         190,
    "Retail F&B":      165,
    "Retail Home":     170,
    "Retail Apparel":  175,
    "Retail Durable":  180,
    "Transport":       185,
    "Retail Other":    195,
    "Travel":          200,
    "Services":        205,
    "Gaming":          230,
    "Tobacco":         240,
    "Digital":         235,
    "Pharma":          245,
    "Direct Mktg":     250,
    "Financial":       250,
    "Quasi-Cash":      260,
    "Adult":           275,
    "Gambling":        280,
}
# Fallback for any group not enumerated above.
INTERCHANGE_BPS_DEFAULT = 195

CHARGEBACK_REASONS = {
    "10.1": "EMV Liability Shift Counterfeit Fraud",
    "10.2": "EMV Liability Shift Non-Counterfeit Fraud",
    "10.3": "Other Fraud - Card Present Environment",
    "10.4": "Other Fraud - Card Absent Environment",
    "10.5": "Visa Fraud Monitoring Program",
    "11.3": "No Authorization",
    "12.5": "Incorrect Amount",
    "12.6": "Duplicate Processing",
    "13.1": "Merchandise / Services Not Received",
    "13.2": "Cancelled Recurring Transaction",
    "13.3": "Not as Described or Defective",
    "13.5": "Misrepresentation",
    "13.6": "Credit Not Processed",
    "13.7": "Cancelled Merchandise / Services",
}

FRAUD_TYPES = [
    "Counterfeit / skimmed",
    "Lost or stolen",
    "Card absent - CNP",
    "Account takeover",
    "Never received issue",
    "Fraudulent application",
    "Manipulation of account holder",
]

CARD_PRODUCTS = [
    ("V", "Visa Classic",   "CREDIT",  "PERSONAL", 0.28),
    ("D", "Visa Debit",     "DEBIT",   "PERSONAL", 0.34),
    ("P", "Visa Gold",      "CREDIT",  "PERSONAL", 0.10),
    ("S", "Visa Signature", "CREDIT",  "PERSONAL", 0.11),
    ("F", "Visa Infinite",  "CREDIT",  "PERSONAL", 0.03),
    ("B", "Visa Business",  "CREDIT",  "COMMERCIAL", 0.07),
    ("K", "Visa Corporate", "CREDIT",  "COMMERCIAL", 0.03),
    ("R", "Visa Prepaid",   "PREPAID", "PERSONAL", 0.04),
]

WALLETS = ["", "", "", "", "APPLE_PAY", "GOOGLE_PAY", "SAMSUNG_PAY", "CLICK_TO_PAY"]

US_CITIES = [
    ("New York", "NY", "10018"), ("Los Angeles", "CA", "90015"),
    ("Chicago", "IL", "60607"), ("Houston", "TX", "77002"),
    ("Phoenix", "AZ", "85004"), ("Philadelphia", "PA", "19107"),
    ("San Antonio", "TX", "78205"), ("San Diego", "CA", "92101"),
    ("Dallas", "TX", "75201"), ("Austin", "TX", "78701"),
    ("Columbus", "OH", "43215"), ("Charlotte", "NC", "28202"),
    ("Indianapolis", "IN", "46204"), ("Seattle", "WA", "98101"),
    ("Denver", "CO", "80202"), ("Boston", "MA", "02110"),
    ("Nashville", "TN", "37203"), ("Portland", "OR", "97205"),
    ("Las Vegas", "NV", "89109"), ("Miami", "FL", "33131"),
    ("Cleveland", "OH", "44113"), ("Tampa", "FL", "33602"),
    ("Sunnyvale", "CA", "94085"), ("Newark", "NJ", "07102"),
]
