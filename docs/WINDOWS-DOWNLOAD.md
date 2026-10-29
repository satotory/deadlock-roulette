# Windows download / Скачивание на Windows

[English](#english) · [Русский](#русский) · [Project README](../README.md)

## English

Release **1.10.1 is unsigned**. SmartScreen considers both publisher and file reputation; Windows may display **Unknown publisher** or **Windows protected your PC**. [Microsoft explains these reputation checks](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation).

1. Download `Deadlock.Roulette.exe` and `SHA256SUMS.txt` only from the [official GitHub release](https://github.com/satotory/deadlock-roulette/releases/latest).
2. In PowerShell, open the download folder and calculate the file’s SHA-256:

```powershell
Get-FileHash .\Deadlock.Roulette.exe -Algorithm SHA256
```

For **release 1.10.1**, the expected hash is:

```text
1e76c89228d673325ce27f1aa5fc40b5e259e9d4a94266f0764fccd72476fb19
```

Compare the complete hash with `SHA256SUMS.txt`. A match confirms that the bytes match the published file; **it does not prove the absence of malware**. This hash applies only to this exact release file.

3. Only if you trust the verified official download, choose **More info → Run anyway** in SmartScreen. Some Windows policies do not offer this option.

Keep Defender and SmartScreen enabled. Removing the download mark or adding a self-signed certificate is not a replacement for trusted code signing. A trusted signature identifies the publisher but does not guarantee immediate warning-free downloads. [Microsoft’s signing guidance](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation) describes the distinction.

## Русский

Релиз **1.10.1 не подписан**. SmartScreen учитывает репутацию издателя и самого файла: Windows может показать **«Неизвестный издатель»** или **«Система Windows защитила ваш компьютер»**. [Объяснение этих проверок у Microsoft](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation).

1. Скачай `Deadlock.Roulette.exe` и `SHA256SUMS.txt` только из [официального релиза на GitHub](https://github.com/satotory/deadlock-roulette/releases/latest).
2. Открой папку загрузки в PowerShell и посчитай SHA-256 файла:

```powershell
Get-FileHash .\Deadlock.Roulette.exe -Algorithm SHA256
```

Ожидаемый хеш **для релиза 1.10.1**:

```text
1e76c89228d673325ce27f1aa5fc40b5e259e9d4a94266f0764fccd72476fb19
```

Сравни хеш целиком с `SHA256SUMS.txt`. Совпадение подтверждает одинаковые байты с опубликованным файлом, **но не доказывает отсутствие вредоносного кода**. Этот хеш относится только к данному файлу релиза.

3. Только если доверяешь проверенному официальному файлу, выбери в SmartScreen **«Подробнее → Выполнить в любом случае»**. Некоторые политики Windows не дают такой возможности.

Оставь Defender и SmartScreen включёнными. Удаление метки загрузки или самоподписанный сертификат не заменяют доверенную подпись. Доверенная подпись позволяет установить издателя, но не гарантирует мгновенное исчезновение предупреждений. Разницу описывает [руководство Microsoft](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation).
