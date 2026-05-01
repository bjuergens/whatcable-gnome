// WhatCable-Linux CLI
// Port of WhatCableCLI from WhatCable by Darryl Morley
// https://github.com/darrylmorley/whatcable
#include <QCoreApplication>
#include <QCommandLineParser>
#include <QTimer>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QTextStream>
#include <csignal>

#include "DeviceManager.h"
#include "UsbClassDB.h"
#include "PDDecoder.h"

using namespace WhatCable;

static QTextStream &out()
{
    static QTextStream s(stdout);
    return s;
}

static const char *RESET  = "\033[0m";
static const char *BOLD   = "\033[1m";
static const char *DIM    = "\033[2m";
static const char *GREEN  = "\033[32m";
static const char *YELLOW = "\033[33m";
static const char *BLUE   = "\033[34m";
static const char *CYAN   = "\033[36m";

static void printTextSummary(const DeviceManager &mgr, bool showRaw)
{
    const auto &devices = mgr.devices();
    if (devices.isEmpty()) {
        out() << "No USB devices found." << Qt::endl;
        return;
    }

    for (const auto &dev : devices) {
        out() << BOLD;
        if (dev.category == DeviceSummary::TypeCPortCategory)
            out() << CYAN;
        else if (dev.category == DeviceSummary::HubCategory)
            out() << BLUE;
        else
            out() << GREEN;

        out() << dev.headline << RESET << Qt::endl;

        if (!dev.subtitle.isEmpty())
            out() << "  " << dev.subtitle << Qt::endl;

        for (const auto &bullet : dev.bullets)
            out() << "  " << DIM << "• " << RESET << bullet << Qt::endl;

        if (dev.chargingDiag) {
            const auto &diag = *dev.chargingDiag;
            if (diag.isWarning)
                out() << "  " << YELLOW << "⚠ " << diag.summary << RESET << Qt::endl;
            else
                out() << "  " << GREEN << "✓ " << diag.summary << RESET << Qt::endl;
            if (!diag.detail.isEmpty())
                out() << "    " << DIM << diag.detail << RESET << Qt::endl;
        }

        if (dev.powerDelivery && !dev.powerDelivery->sourceCapabilities.isEmpty()) {
            out() << "  " << BOLD << "Charger profiles:" << RESET << Qt::endl;
            for (const auto &pdo : dev.powerDelivery->sourceCapabilities) {
                QString marker = pdo.isActive ? QStringLiteral(" ◀ active") : QString();
                out() << "    " << pdo.voltageLabel() << " @ " << pdo.currentLabel()
                       << " — " << pdo.powerLabel();
                if (!marker.isEmpty())
                    out() << GREEN << marker << RESET;
                out() << Qt::endl;
            }
        }

        if (showRaw) {
            QMap<QString, QString> attrs;
            if (dev.usbDevice)
                attrs = dev.usbDevice->rawAttributes;
            else if (dev.typecPort)
                attrs = dev.typecPort->rawAttributes;
            if (!attrs.isEmpty()) {
                out() << "  " << DIM << "Raw sysfs attributes:" << RESET << Qt::endl;
                for (auto it = attrs.begin(); it != attrs.end(); ++it)
                    out() << "    " << it.key() << " = " << it.value() << Qt::endl;
            }
        }

        out() << Qt::endl;
    }
}

static QJsonObject deviceToJson(const DeviceSummary &dev, bool showRaw)
{
    QJsonObject obj;
    obj[QStringLiteral("category")] = dev.category == DeviceSummary::TypeCPortCategory
        ? QStringLiteral("typec") : (dev.category == DeviceSummary::HubCategory
        ? QStringLiteral("hub") : QStringLiteral("usb"));
    obj[QStringLiteral("headline")] = dev.headline;
    obj[QStringLiteral("subtitle")] = dev.subtitle;
    obj[QStringLiteral("icon")] = dev.icon;

    QJsonArray bulletsArr;
    for (const auto &b : dev.bullets)
        bulletsArr.append(b);
    obj[QStringLiteral("bullets")] = bulletsArr;

    if (dev.usbDevice) {
        QJsonObject usb;
        usb[QStringLiteral("vendorId")] = QStringLiteral("0x%1").arg(dev.usbDevice->vendorId, 4, 16, QChar('0'));
        usb[QStringLiteral("productId")] = QStringLiteral("0x%1").arg(dev.usbDevice->productId, 4, 16, QChar('0'));
        usb[QStringLiteral("manufacturer")] = dev.usbDevice->manufacturer;
        usb[QStringLiteral("product")] = dev.usbDevice->product;
        usb[QStringLiteral("speed")] = dev.usbDevice->speed;
        usb[QStringLiteral("speedLabel")] = dev.usbDevice->speedLabel();
        usb[QStringLiteral("version")] = dev.usbDevice->version;
        usb[QStringLiteral("maxPowerMA")] = dev.usbDevice->maxPowerMA;
        usb[QStringLiteral("serial")] = dev.usbDevice->serial;
        usb[QStringLiteral("removable")] = dev.usbDevice->removable;
        usb[QStringLiteral("bus")] = dev.usbDevice->busNum;
        usb[QStringLiteral("device")] = dev.usbDevice->devNum;
        usb[QStringLiteral("isHub")] = dev.usbDevice->isHub;

        QJsonArray ifaces;
        for (const auto &iface : dev.usbDevice->interfaces) {
            QJsonObject ifObj;
            ifObj[QStringLiteral("class")] = UsbClassDB::className(iface.classCode);
            ifObj[QStringLiteral("driver")] = iface.driver;
            ifaces.append(ifObj);
        }
        usb[QStringLiteral("interfaces")] = ifaces;

        if (showRaw) {
            QJsonObject raw;
            for (auto it = dev.usbDevice->rawAttributes.begin(); it != dev.usbDevice->rawAttributes.end(); ++it)
                raw[it.key()] = it.value();
            usb[QStringLiteral("raw")] = raw;
        }
        obj[QStringLiteral("usb")] = usb;
    }

    if (dev.typecPort) {
        QJsonObject tc;
        tc[QStringLiteral("port")] = dev.typecPort->portNumber;
        tc[QStringLiteral("dataRole")] = dev.typecPort->currentDataRole();
        tc[QStringLiteral("powerRole")] = dev.typecPort->currentPowerRole();
        tc[QStringLiteral("portType")] = dev.typecPort->portType;
        tc[QStringLiteral("powerOpMode")] = dev.typecPort->powerOpMode;
        tc[QStringLiteral("connected")] = dev.typecPort->isConnected();
        if (showRaw) {
            QJsonObject raw;
            for (auto it = dev.typecPort->rawAttributes.begin(); it != dev.typecPort->rawAttributes.end(); ++it)
                raw[it.key()] = it.value();
            tc[QStringLiteral("raw")] = raw;
        }
        obj[QStringLiteral("typec")] = tc;
    }

    if (dev.cable) {
        QJsonObject cab;
        cab[QStringLiteral("type")] = dev.cable->cableType;
        if (dev.cable->speed)
            cab[QStringLiteral("speed")] = cableSpeedLabel(*dev.cable->speed);
        if (dev.cable->currentRating)
            cab[QStringLiteral("current")] = cableCurrentLabel(*dev.cable->currentRating);
        cab[QStringLiteral("maxWatts")] = dev.cable->maxWatts;
        cab[QStringLiteral("vendorId")] = QStringLiteral("0x%1").arg(dev.cable->vendorId, 4, 16, QChar('0'));
        cab[QStringLiteral("vendorName")] = dev.cable->vendorName;
        obj[QStringLiteral("cable")] = cab;
    }

    if (dev.powerDelivery) {
        QJsonObject pdObj;
        QJsonArray pdos;
        for (const auto &pdo : dev.powerDelivery->sourceCapabilities) {
            QJsonObject p;
            p[QStringLiteral("type")] = pdo.typeLabel();
            p[QStringLiteral("voltageMV")] = pdo.voltageMV;
            p[QStringLiteral("currentMA")] = pdo.currentMA;
            p[QStringLiteral("powerMW")] = pdo.powerMW;
            p[QStringLiteral("active")] = pdo.isActive;
            pdos.append(p);
        }
        pdObj[QStringLiteral("sourceCapabilities")] = pdos;
        pdObj[QStringLiteral("maxPowerMW")] = dev.powerDelivery->maxSourcePowerMW;
        obj[QStringLiteral("powerDelivery")] = pdObj;
    }

    if (dev.chargingDiag) {
        QJsonObject diag;
        diag[QStringLiteral("summary")] = dev.chargingDiag->summary;
        diag[QStringLiteral("detail")] = dev.chargingDiag->detail;
        diag[QStringLiteral("isWarning")] = dev.chargingDiag->isWarning;
        obj[QStringLiteral("charging")] = diag;
    }

    return obj;
}

static void printJsonSummary(const DeviceManager &mgr, bool showRaw)
{
    QJsonArray arr;
    for (const auto &dev : mgr.devices())
        arr.append(deviceToJson(dev, showRaw));
    out() << QJsonDocument(arr).toJson(QJsonDocument::Indented) << Qt::endl;
}

int main(int argc, char *argv[])
{
    QCoreApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("whatcable-linux"));
    app.setApplicationVersion(QStringLiteral("0.1.0"));

    QCommandLineParser parser;
    parser.setApplicationDescription(
        QStringLiteral("WhatCable-Linux — shows what each USB cable/device can do.\n"
                       "Port of WhatCable (macOS) by Darryl Morley."));
    parser.addHelpOption();
    parser.addVersionOption();

    QCommandLineOption jsonOpt(QStringLiteral("json"), QStringLiteral("Output structured JSON"));
    QCommandLineOption watchOpt(QStringLiteral("watch"), QStringLiteral("Stream updates as devices come and go"));
    QCommandLineOption rawOpt(QStringLiteral("raw"), QStringLiteral("Include raw sysfs attributes"));
    parser.addOption(jsonOpt);
    parser.addOption(watchOpt);
    parser.addOption(rawOpt);

    parser.process(app);

    bool useJson = parser.isSet(jsonOpt);
    bool watchMode = parser.isSet(watchOpt);
    bool showRaw = parser.isSet(rawOpt);

    DeviceManager mgr;

    if (watchMode) {
        // Signal handler for clean exit
        signal(SIGINT, [](int) { QCoreApplication::quit(); });
        signal(SIGTERM, [](int) { QCoreApplication::quit(); });

        QObject::connect(&mgr, &DeviceManager::devicesChanged, [&]() {
            if (!useJson) {
                out() << "\033[2J\033[H"; // clear screen
                printTextSummary(mgr, showRaw);
            } else {
                printJsonSummary(mgr, showRaw);
            }
            out().flush();
        });

        mgr.startMonitoring();
        return app.exec();
    }

    // One-shot mode
    mgr.refresh();
    if (useJson)
        printJsonSummary(mgr, showRaw);
    else
        printTextSummary(mgr, showRaw);

    return 0;
}
